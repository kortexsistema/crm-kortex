/**
 * GET/POST /api/v1/cron/handoff-watcher
 *
 * Varre conversas com status='pending' (handoff em espera) e avança a Fila de Escalonamento
 * caso o último alerta tenha ocorrido há mais de 5 minutos.
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { reativarAutomaticoPorTimeout } from "@/lib/ai/handoff/timeout";

export const dynamic = "force-dynamic";

const SCAN_LIMIT = 200;
const ESCALATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

interface PendingConversation {
  id: string;
  organization_id: string;
  channel_session_id: string | null;
  metadata: Record<string, unknown> | null;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // ─── 1. Reativação automática por timeout de inatividade (Regra 2) ───────────
  // Busca conversas pausadas pela IA (status='pending' ou 'open', sem dono humano)
  // cujo bot_silenced_until já expirou (passou dos 120min ou configurado na org),
  // bem como casos legados onde last_handoff_at passou de 120min sem travamento manual ('infinity').
  let autoResumedCount = 0;
  const legacyCutoffIso = new Date(now.getTime() - 120 * 60 * 1000).toISOString();

  // (a) Conversas com bot_silenced_until expirado (não-infinito)
  const { data: expiredConversations, error: expErr } = await admin
    .from("conversations")
    .select("id, organization_id, bot_silenced_until, last_handoff_at")
    .in("status", ["pending", "open"])
    .is("assigned_to_user_id", null)
    .not("bot_silenced_until", "is", null)
    .neq("bot_silenced_until", "infinity")
    .lte("bot_silenced_until", nowIso)
    .limit(SCAN_LIMIT);

  // (b) Casos legados sem bot_silenced_until (ou nulo) onde last_handoff_at excedeu 120 minutos
  const { data: legacyStaleConversations, error: legErr } = await admin
    .from("conversations")
    .select("id, organization_id, bot_silenced_until, last_handoff_at")
    .in("status", ["pending", "open"])
    .is("assigned_to_user_id", null)
    .is("bot_silenced_until", null)
    .not("last_handoff_at", "is", null)
    .lte("last_handoff_at", legacyCutoffIso)
    .limit(SCAN_LIMIT);

  // (c) Casos legados da IA com bot_silenced_until='infinity' sem dono humano onde last_handoff_at excedeu 120min ou é nulo
  const { data: legacyInfinityConversations, error: infErr } = await admin
    .from("conversations")
    .select("id, organization_id, bot_silenced_until, last_handoff_at")
    .in("status", ["pending", "open"])
    .is("assigned_to_user_id", null)
    .eq("bot_silenced_until", "infinity")
    .or(`last_handoff_at.lte.${legacyCutoffIso},last_handoff_at.is.null`)
    .limit(SCAN_LIMIT);

  if (expErr) {
    logger.warn("[handoff-watcher] falha ao buscar conversas expiradas", { error: expErr.message });
  }
  if (legErr) {
    logger.warn("[handoff-watcher] falha ao buscar conversas legadas expiradas", { error: legErr.message });
  }
  if (infErr) {
    logger.warn("[handoff-watcher] falha ao buscar conversas legadas infinity", { error: infErr.message });
  }

  // Deduplicar conversas para reativação
  const candidateMap = new Map<string, { id: string; organization_id: string }>();
  for (const c of expiredConversations ?? []) {
    candidateMap.set(c.id, { id: c.id, organization_id: c.organization_id });
  }
  for (const c of legacyStaleConversations ?? []) {
    candidateMap.set(c.id, { id: c.id, organization_id: c.organization_id });
  }
  for (const c of legacyInfinityConversations ?? []) {
    candidateMap.set(c.id, { id: c.id, organization_id: c.organization_id });
  }

  if (candidateMap.size > 0) {
    for (const exp of candidateMap.values()) {
      const res = await reativarAutomaticoPorTimeout(admin, {
        conversationId: exp.id,
        organizationId: exp.organization_id,
        motivo: "inactivity_timeout",
      });
      if (res.ok) {
        autoResumedCount++;
      }
    }
  }

  // ─── 2. Escalonamento de alertas aos gestores da org ─────────────────────────
  // Limiar de tempo: tudo o que foi escalado antes desta data está atrasado.
  const timeoutThresholdIso = new Date(now.getTime() - ESCALATION_TIMEOUT_MS).toISOString();

  // Pesquisar conversas pendentes (sem dono humano) que tenham um escalonamento ativo,
  // e que esse escalonamento seja mais antigo que o limiar (5 mins).
  const { data: due, error: queryError } = await admin
    .from("conversations")
    .select("id, organization_id, channel_session_id, metadata")
    .eq("status", "pending")
    .is("assigned_to_user_id", null)
    .not("metadata->handoff_escalation_at", "is", null)
    .lte("metadata->>handoff_escalation_at", timeoutThresholdIso)
    .limit(SCAN_LIMIT);

  if (queryError) {
    logger.error("[handoff-watcher] query failed", { error: queryError.message, requestId });
    return fail("internal_error", "Failed to query conversations.", 500, { requestId });
  }

  const conversations = (due ?? []) as PendingConversation[];
  let escalationsCount = 0;

  for (const c of conversations) {
    const currentIndex = Number(c.metadata?.handoff_escalation_index ?? 0);
    const nextIndex = currentIndex + 1;

    // 1. Obter os contactos de alerta da organização
    const { data: orgRow } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", c.organization_id)
      .maybeSingle();

    const settings = orgRow?.settings as Record<string, unknown> | undefined;
    const legacyPhone = settings?.handoff_alert_phone as string | undefined;
    const alertContacts = (settings?.handoff_alert_contacts as { name: string; phone: string }[]) ??
                          (legacyPhone ? [{ name: "Gestor", phone: legacyPhone }] : []);

    // Se já avisou todos, simplesmente atualiza o metadata para remover o escalonamento 
    // ou deixá-lo no máximo, para não reprocessar.
    if (nextIndex >= alertContacts.length) {
      await admin.from("conversations").update({
        metadata: {
          ...(c.metadata ?? {}),
          handoff_escalation_at: null, // Pára o relógio
        }
      }).eq("id", c.id);
      continue;
    }

    // 2. Há um próximo gestor para notificar.
    const contact = alertContacts[nextIndex];
    if (contact) {
      const telefoneGestor = contact.phone.replace(/\D/g, "");
      
      if (telefoneGestor) {
        // Enviar WhatsApp (best-effort)
        try {
          const { sendWAHA } = await import("@/lib/waha/send");
          let wahaSessionName: string | null = null;
          
          if (c.channel_session_id) {
            const { data: sess } = await admin
              .from("channel_sessions")
              .select("waha_session_name")
              .eq("id", c.channel_session_id)
              .maybeSingle();
            if (sess?.waha_session_name) wahaSessionName = sess.waha_session_name;
          }

          if (!wahaSessionName) {
            const { data: sessFb } = await admin
              .from("channel_sessions")
              .select("waha_session_name")
              .eq("organization_id", c.organization_id)
              .is("archived_at", null)
              .limit(1)
              .maybeSingle();
            if (sessFb?.waha_session_name) wahaSessionName = sessFb.waha_session_name;
          }

          if (wahaSessionName) {
            // Tentamos pegar a ultima msg do lead
            let ultimaMensagem = "[Não encontrada]";
            const { data: msgs } = await admin
              .from("messages")
              .select("body")
              .eq("conversation_id", c.id)
              .eq("actor_kind", "contact")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (msgs?.body) ultimaMensagem = msgs.body;

            const textoAlerta = `🚨 *Kortex Escalonamento*\n\nOlá ${contact.name}, um handoff continua sem resposta após 5 minutos.\n\n*Última mensagem do cliente:*\n"${ultimaMensagem}"\n\n🔗 Acesse o Inbox para assumir:\nhttps://crmkortex.app/app/inbox`;

            await sendWAHA({
              sessionName: wahaSessionName,
              chatId: `${telefoneGestor}@c.us`,
              text: textoAlerta,
            });
          }
        } catch (err) {
          logger.warn("[handoff-watcher] sendWAHA failed for escalation", {
            conversation_id: c.id,
            phone: telefoneGestor,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 3. Atualizar a base de dados com o novo índice
    await admin.from("conversations").update({
      metadata: {
        ...(c.metadata ?? {}),
        handoff_escalation_index: nextIndex,
        handoff_escalation_at: nowIso,
      }
    }).eq("id", c.id);

    escalationsCount++;
  }

  if (escalationsCount > 0 || autoResumedCount > 0) {
    void audit({
      action: "conversation.handoff_watcher_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { scanned: conversations.length, auto_resumed: autoResumedCount, escalations: escalationsCount },
      requestId,
    });
  }

  return ok({ scanned: conversations.length, auto_resumed: autoResumedCount, escalations: escalationsCount }, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
