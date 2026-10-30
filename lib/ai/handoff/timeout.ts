/**
 * CONTROLE DE TIMEOUT DE HANDOFF E RETORNO AO MODO AUTOMÁTICO
 *
 * Divide o atendimento em duas regras distintas:
 *
 * 1. "Assumido por Humano" (Botão "Assumir"):
 *    - Quando o operador assume explicitamente a conversa (fn_conversation_assign com 'claim'),
 *      o chat permanece em Modo Manual Permanente de forma indefinida (bot_silenced_until='infinity',
 *      assignee_kind='user', assigned_to_user_id=<user_id>).
 *    - Só volta ao automático se o operador clicar em "Devolver ao automático"
 *      (devolverAtendimentoAoAgente) ou fechar a demanda/conversa ("Fechar").
 *
 * 2. "Handoff Automático pela IA" (ex: limite de escopo, sentinela, sentiment, triggers G1-G4):
 *    - A IA pausa o atendimento temporariamente iniciando um contador de inatividade configurável
 *      (padrão de 120 minutos, definido em organizations.settings.ai_handoff_timeout_minutes).
 *    - Se houver silêncio ou se nenhum humano interagir dentro desse prazo, o sistema reativa o
 *      bot para o modo automático de forma limpa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { autorizarContatoParaIA } from "@/lib/ai/elegibilidade/autorizacao";

/** Tempo padrão de inatividade para retorno automático após handoff da IA: 120 minutos (2 horas). */
export const DEFAULT_HANDOFF_TIMEOUT_MINUTES = 120;

/**
 * Resolve o tempo de timeout em minutos a partir das configurações da organização.
 * Padrão: 120 minutos. Mínimo 1 minuto, máximo 10080 (7 dias).
 */
export function resolveHandoffTimeoutMinutes(
  settings?: Record<string, unknown> | null,
): number {
  if (!settings) return DEFAULT_HANDOFF_TIMEOUT_MINUTES;
  const raw =
    settings["ai_handoff_timeout_minutes"] ?? settings["handoff_timeout_minutes"];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(Math.floor(parsed), 1), 10080);
  }
  return DEFAULT_HANDOFF_TIMEOUT_MINUTES;
}

/**
 * Calcula a data de expiração do silêncio a partir do instante atual.
 */
export function calcularExpiracaoDoHandoff(
  timeoutMinutes: number,
  agora: Date = new Date(),
): Date {
  return new Date(agora.getTime() + timeoutMinutes * 60 * 1000);
}

/**
 * Verifica se um silêncio configurado já expirou por inatividade.
 * Retorna false se o silêncio for durável ('infinity') ou se ainda estiver no futuro.
 */
export function isHandoffExpired(
  botSilencedUntil: string | Date | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!botSilencedUntil) return false;
  if (botSilencedUntil === "infinity") return false;
  const ate = typeof botSilencedUntil === "string" ? new Date(botSilencedUntil) : botSilencedUntil;
  if (Number.isNaN(ate.getTime())) return false;
  return agora.getTime() >= ate.getTime();
}

export interface ReativacaoTimeoutInput {
  conversationId: string;
  organizationId: string;
  motivo?: string;
}

export interface ReativacaoTimeoutResult {
  ok: boolean;
  reason?: string;
  conversationId: string;
}

/**
 * Reativa o bot para o modo automático de forma limpa quando o timeout de inatividade
 * da IA expira sem interação humana.
 *
 * GARANTIAS DE SEGURANÇA:
 * - Nunca reativa conversas assumidas por humanos (assigned_to_user_id IS NOT NULL).
 * - Nunca reativa conversas com silêncio permanente ('infinity').
 * - Nunca reativa conversas encerradas ('closed', 'archived', 'resolved').
 * - Restaura status para 'ai_handling' (ou 'open').
 * - Limpa bot_silenced_until, last_handoff_at, last_handoff_reason.
 * - Desbloqueia contacts.force_human se estiver ativo e re-autoriza o contato para IA.
 * - Emite o evento durável 'ai.handoff_resolved'.
 * - Emite atividade na timeline do lead e broadcast no realtime.
 */
export async function reativarAutomaticoPorTimeout(
  admin: SupabaseClient,
  input: ReativacaoTimeoutInput,
): Promise<ReativacaoTimeoutResult> {
  const { conversationId, organizationId, motivo } = input;
  const agora = new Date();
  const agoraIso = agora.toISOString();

  try {
    const { data: conv, error: convErr } = await admin
      .from("conversations")
      .select("id, contact_id, status, assigned_to_user_id, assignee_kind, bot_silenced_until, last_handoff_at, metadata")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (convErr) {
      logger.warn("[handoff.timeout] erro ao consultar conversa", {
        conversation_id: conversationId,
        error: convErr.message,
      });
      return { ok: false, reason: "query_error", conversationId };
    }
    if (!conv) {
      return { ok: false, reason: "conversation_not_found", conversationId };
    }

    // Regra 1: se um humano assumiu a conversa, o modo manual é permanente até que
    // ele explicitamente devolva ou feche. NUNCA auto-reativar!
    if (conv.assigned_to_user_id !== null || conv.assignee_kind === "user") {
      return { ok: false, reason: "has_human_assignee", conversationId };
    }

    // Conversa encerrada
    const status = conv.status ?? "";
    if (["closed", "archived", "resolved"].includes(status)) {
      return { ok: false, reason: "conversation_closed", conversationId };
    }

    // Verifica se o prazo de silêncio realmente já venceu
    if (conv.bot_silenced_until === "infinity") {
      // Casos legados onde a IA gravava 'infinity' na fila sem operador humano (assigned_to_user_id is null):
      // Se last_handoff_at for recente (< 120min), ainda aguarda na fila.
      const lastHandoff = conv.last_handoff_at ? new Date(conv.last_handoff_at) : null;
      if (lastHandoff && !Number.isNaN(lastHandoff.getTime())) {
        const timeoutMs = DEFAULT_HANDOFF_TIMEOUT_MINUTES * 60 * 1000;
        if (agora.getTime() - lastHandoff.getTime() < timeoutMs) {
          return { ok: false, reason: "timeout_not_elapsed", conversationId };
        }
      }
    } else if (conv.bot_silenced_until) {
      const ate = new Date(conv.bot_silenced_until);
      if (!Number.isNaN(ate.getTime()) && ate.getTime() > agora.getTime()) {
        return { ok: false, reason: "timeout_not_elapsed", conversationId };
      }
    }

    // Transição atômica da conversa de volta ao automático
    const proximoStatus = status === "pending" || status === "open" ? "ai_handling" : status;
    const { data: updated, error: updErr } = await admin
      .from("conversations")
      .update({
        bot_silenced_until: null,
        last_handoff_at: null,
        last_handoff_reason: null,
        assignee_kind: "ai",
        status: proximoStatus,
        status_changed_at: agoraIso,
        metadata: {
          ...((conv.metadata as Record<string, unknown> | null) ?? {}),
          handoff_mode: null,
          handoff_timeout_minutes: null,
          handoff_expires_at: null,
          handoff_escalation_at: null,
          handoff_auto_resumed_at: agoraIso,
          handoff_auto_resumed_reason: motivo ?? "inactivity_timeout",
        },
      })
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .is("assigned_to_user_id", null)
      .select("id")
      .maybeSingle();

    if (updErr || !updated) {
      logger.warn("[handoff.timeout] atualização da conversa falhou ou houve corrida", {
        conversation_id: conversationId,
        error: updErr?.message,
      });
      return { ok: false, reason: "update_conflict", conversationId };
    }

    // Destrava contato se necessário e re-autoriza para IA
    if (conv.contact_id) {
      await admin
        .from("contacts")
        .update({ force_human: false })
        .eq("id", conv.contact_id)
        .eq("organization_id", organizationId);

      await autorizarContatoParaIA(admin, {
        organizationId,
        contactId: conv.contact_id,
        reason: "retomada_timeout_inatividade",
      }).catch((err) => {
        logger.warn("[handoff.timeout] autorizarContatoParaIA falhou", {
          contact_id: conv.contact_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Emissão do evento de resolução do handoff
    await admin.rpc("emit_event" as never, {
      p_event_type: "ai.handoff_resolved",
      p_entity_kind: "conversation",
      p_entity_id: conversationId,
      p_payload: {
        conversation_id: conversationId,
        contact_id: conv.contact_id,
        organization_id: organizationId,
        resumed_by: "inactivity_timeout",
      },
      p_metadata: { source: "handoff.timeout_resumed" },
      p_organization_id: organizationId,
    } as never);

    // Timeline do lead (se houver)
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contact_id", conv.contact_id ?? "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead?.id) {
      await admin.from("crm_lead_activities").insert({
        organization_id: organizationId,
        lead_id: lead.id,
        type: "handoff_resumed_timeout",
        source_module: "ai",
        payload: {
          conversation_id: conversationId,
          reason: "Timeout de inatividade sem resposta humana. Modo automático reativado.",
        },
        metadata: {
          actor_kind: "system",
          resumed_at: agoraIso,
        },
      });
    }

    // Broadcast Realtime para a fila do Inbox
    try {
      const channel = admin.channel(`org:${organizationId}:queue`);
      await channel.send({
        type: "broadcast",
        event: "handoff_resolved",
        payload: { conversation_id: conversationId, resumed_by: "timeout" },
      });
    } catch {
      // Realtime broadcast é best-effort
    }

    // Auditoria
    await audit({
      action: "conversation.ai_auto_resumed",
      organizationId,
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: { reason: motivo ?? "inactivity_timeout" },
    });

    logger.info("[handoff.timeout] atendimento reativado automaticamente com sucesso", {
      conversation_id: conversationId,
      organization_id: organizationId,
    });

    return { ok: true, conversationId };
  } catch (err) {
    logger.error("[handoff.timeout] exceção ao reativar conversa", {
      conversation_id: conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "exception", conversationId };
  }
}
