import { tool } from "ai";
import { z } from "zod";
import type pg from "pg";
import { UnifiedAppointmentProvider } from "@/lib/appointments/provider";

export const appointmentReminderSkill = {
  name: "appointment_reminder",
  description: "Lida com intenções de confirmação ou reagendamento de um compromisso pendente.",
  body: `## Lembretes de Compromisso pendentes
Se o lead responder confirmando o compromisso ou pedindo para reagendar, use a ferramenta "update_appointment_status" com o ID do compromisso retornado (ou deduza pelo contexto) para atualizar o sistema de acordo. Nunca prometa confirmação sem chamar a ferramenta.
Se o lead pedir para reagendar, altere o status para "remarcar" e pergunte qual o melhor horário.`,
  matcher: {
    any_keywords: ["confirmado", "confirmo", "sim", "reagendar", "remarcar", "pode ser", "ok", "outro horario", "não poderei"],
    probe_keywords: []
  }
};

export function createAppointmentReminderTool(pool: pg.Pool) {
  return tool({
    description: "Atualiza o status de um compromisso (nativo ou externo) para 'confirmado' ou 'remarcar'.",
    inputSchema: z.object({
      id: z.string().describe("O ID do compromisso a ser atualizado."),
      status: z.enum(["confirmado", "remarcar"]).describe("O novo status desejado pelo cliente.")
    }),
    execute: async (args) => {
      try {
        const provider = new UnifiedAppointmentProvider(pool);
        const success = await provider.updateAppointmentStatus(args.id, args.status);
        if (success) {
          return { success: true, message: `Compromisso ${args.id} atualizado para ${args.status} com sucesso.` };
        } else {
          return { success: false, message: `Compromisso ${args.id} não encontrado em nenhuma origem (nativa ou externa).` };
        }
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  });
}
