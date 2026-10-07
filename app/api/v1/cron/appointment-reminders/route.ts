import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendWAHA } from "@/lib/waha/send";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { createPool } from "@/lib/agent-engine/db/pool";
import { UnifiedAppointmentProvider } from "@/lib/appointments/provider";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? "";
  const provided = bearer || headerSecret;

  const cronSecret = env.INTERNAL_CRON_SECRET;
  const fallbackSecret = env.INTERNAL_SECRET;
  const accepted: string[] = [];
  if (cronSecret) accepted.push(cronSecret);
  if (fallbackSecret) accepted.push(fallbackSecret);

  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const pool = createPool(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "");
    const provider = new UnifiedAppointmentProvider(pool);
    const appointments = await provider.getPendingReminders();

    let sentCount = 0;

    for (const appt of appointments) {
      try {
        const systemPrompt = `Você é um assistente virtual gentil enviando um lembrete de compromisso.
Dados do compromisso:
Nome: ${appt.clientName}
Data: ${new Date(appt.startsAt).toLocaleString('pt-BR')}

Redija uma mensagem curta (max 2 frases) confirmando o compromisso e perguntando se o cliente confirma presença ou se deseja reagendar.`;

        // Generate personalized message using LLM
        const llmRes = await runModelCall(pool, {}, {
          tenantId: appt.organizationId,
          purpose: 'appointment_reminder',
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Crie a mensagem de lembrete agora.' }]
        });

        const msgText = llmRes.result.text || `Olá! Lembrando do seu compromisso em ${new Date(appt.startsAt).toLocaleString('pt-BR')}. Confirma?`;

        // Send via Waha
        const wahaSessionName = `org_${appt.organizationId.replace(/-/g, '')}`;
        await sendWAHA({
          sessionName: wahaSessionName.substring(0, 49),
          chatId: appt.clientPhone + "@c.us",
          text: msgText
        });

        // Update unified status to 'enviado'
        await provider.updateAppointmentStatus(appt.id, 'enviado');
        sentCount++;
      } catch (innerErr) {
        logger.warn(`Falha ao enviar lembrete para compromisso ${appt.id}: ${innerErr}`);
      }
    }

    return ok({ sentCount, totalPending: appointments.length }, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[appointment-reminders.cron] threw", { error: detail, requestId });
    return fail("internal_error", detail, 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
