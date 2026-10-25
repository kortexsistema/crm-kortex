import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HANDOFF_TIMEOUT_MINUTES,
  calcularExpiracaoDoHandoff,
  isHandoffExpired,
  reativarAutomaticoPorTimeout,
  resolveHandoffTimeoutMinutes,
} from "@/lib/ai/handoff/timeout";
import { comandoDaConversa } from "@/lib/inbox/comando-da-conversa";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const OPERATOR_ID = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

const mockAutorizarContato = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai/elegibilidade/autorizacao", () => ({
  autorizarContatoParaIA: (...args: unknown[]) => mockAutorizarContato(...args),
}));

describe("Distinção de Comportamento de Handoff e Timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Cálculo e Resolução de Timeout", () => {
    it("usa 120 minutos por padrão se a organização não configurou timeout", () => {
      expect(DEFAULT_HANDOFF_TIMEOUT_MINUTES).toBe(120);
      expect(resolveHandoffTimeoutMinutes(null)).toBe(120);
      expect(resolveHandoffTimeoutMinutes({})).toBe(120);
      expect(resolveHandoffTimeoutMinutes({ ai_handoff_timeout_minutes: 0 })).toBe(120);
      expect(resolveHandoffTimeoutMinutes({ ai_handoff_timeout_minutes: -10 })).toBe(120);
    });

    it("respeita o timeout configurado na organização", () => {
      expect(resolveHandoffTimeoutMinutes({ ai_handoff_timeout_minutes: 60 })).toBe(60);
      expect(resolveHandoffTimeoutMinutes({ ai_handoff_timeout_minutes: 180 })).toBe(180);
      expect(resolveHandoffTimeoutMinutes({ handoff_timeout_minutes: 90 })).toBe(90);
    });

    it("calcula data de expiração corretamente a partir do instante atual", () => {
      const agora = new Date("2026-10-24T10:00:00.000Z");
      const exp = calcularExpiracaoDoHandoff(120, agora);
      expect(exp.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    });

    it("isHandoffExpired reconhece expiração e respeita silêncio infinito", () => {
      const agora = new Date("2026-10-24T12:00:00.000Z");
      expect(isHandoffExpired("infinity", agora)).toBe(false);
      expect(isHandoffExpired("2026-10-24T12:30:00.000Z", agora)).toBe(false);
      expect(isHandoffExpired("2026-10-24T11:59:59.000Z", agora)).toBe(true);
      expect(isHandoffExpired(null, agora)).toBe(false);
    });
  });

  describe("Regra 1: Comportamento 'Assumido por Humano' (Modo Manual Permanente)", () => {
    it("não permite reativação automática por timeout se o operador assumiu a conversa", async () => {
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: CONV_ID,
              contact_id: CONTACT_ID,
              status: "claimed",
              assigned_to_user_id: OPERATOR_ID,
              assignee_kind: "user",
              bot_silenced_until: "infinity",
              metadata: {},
            },
            error: null,
          }),
        }),
      } as unknown as Parameters<typeof reativarAutomaticoPorTimeout>[0];

      const res = await reativarAutomaticoPorTimeout(mockAdmin, {
        conversationId: CONV_ID,
        organizationId: ORG_ID,
      });

      expect(res.ok).toBe(false);
      expect(res.reason).toBe("has_human_assignee");
    });

    it("comandoDaConversa reflete que o operador humano está no comando permanente", () => {
      const fatos = {
        status: "claimed",
        assigned_to_user_id: OPERATOR_ID,
        assigned_to_user_name: "Operador Carlos",
        assignee_kind: "user",
        bot_silenced_until: "infinity",
        force_human: false,
        automaticoDaOrg: true,
      };

      const cmd = comandoDaConversa(fatos, new Date("2026-10-24T10:00:00.000Z"));
      expect(cmd.comando.quem).toBe("humano");
      expect(cmd.automaticoAtivo).toBe(false);
      expect(cmd.motivo).toBe("atendente_no_comando");
      expect(cmd.silencioAte).toBeNull();
    });
  });

  describe("Regra 2: Comportamento 'Handoff Automático pela IA' (Temporizador de Timeout)", () => {
    it("comandoDaConversa exibe status 'aguardando' e motivo 'pausado' com horario de retorno enquanto dentro dos 120min", () => {
      const expiraEm = new Date("2026-10-24T12:00:00.000Z");
      const agora = new Date("2026-10-24T10:00:00.000Z");

      const fatos = {
        status: "pending",
        assigned_to_user_id: null,
        assignee_kind: null,
        bot_silenced_until: expiraEm.toISOString(),
        force_human: false,
        automaticoDaOrg: true,
      };

      const cmd = comandoDaConversa(fatos, agora);
      expect(cmd.comando.quem).toBe("aguardando");
      expect(cmd.automaticoAtivo).toBe(false);
      expect(cmd.motivo).toBe("pausado");
      expect(cmd.silencioAte?.toISOString()).toBe(expiraEm.toISOString());
    });

    it("reativarAutomaticoPorTimeout recusa antes do timeout vencer", async () => {
      const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // Daqui a 1 hora
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: CONV_ID,
              contact_id: CONTACT_ID,
              status: "pending",
              assigned_to_user_id: null,
              assignee_kind: null,
              bot_silenced_until: expiraEm.toISOString(),
              metadata: {},
            },
            error: null,
          }),
        }),
      } as unknown as Parameters<typeof reativarAutomaticoPorTimeout>[0];

      const res = await reativarAutomaticoPorTimeout(mockAdmin, {
        conversationId: CONV_ID,
        organizationId: ORG_ID,
      });

      expect(res.ok).toBe(false);
      expect(res.reason).toBe("timeout_not_elapsed");
    });

    it("reativarAutomaticoPorTimeout reativa limpa e completamente o bot quando o timeout vence", async () => {
      const expiraNoPassado = new Date(Date.now() - 5 * 60 * 1000); // Venceu há 5 min
      const updateConvMock = vi.fn().mockReturnThis();
      const updateContactMock = vi.fn().mockReturnThis();
      const rpcMock = vi.fn().mockResolvedValue({ error: null });
      const channelMock = vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue(undefined),
      });

      const mockAdmin = {
        from: (table: string) => {
          if (table === "conversations") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: CONV_ID,
                  contact_id: CONTACT_ID,
                  status: "pending",
                  assigned_to_user_id: null,
                  assignee_kind: null,
                  bot_silenced_until: expiraNoPassado.toISOString(),
                  metadata: { handoff_mode: "ai_temporary" },
                },
                error: null,
              }),
              update: updateConvMock,
            };
          }
          if (table === "contacts") {
            return {
              update: updateContactMock,
              eq: vi.fn().mockReturnThis(),
            };
          }
          if (table === "crm_leads") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "lead-123" } }),
            };
          }
          if (table === "crm_lead_activities") {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        },
        rpc: rpcMock,
        channel: channelMock,
      } as unknown as Parameters<typeof reativarAutomaticoPorTimeout>[0];

      const res = await reativarAutomaticoPorTimeout(mockAdmin, {
        conversationId: CONV_ID,
        organizationId: ORG_ID,
      });

      expect(res.ok).toBe(true);

      // Verificações essenciais:
      // 1. conversations atualizada: bot_silenced_until=null, assignee_kind='ai', status='ai_handling'
      expect(updateConvMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_silenced_until: null,
          last_handoff_at: null,
          last_handoff_reason: null,
          assignee_kind: "ai",
          status: "ai_handling",
        }),
      );

      // 2. contacts destravado: force_human=false
      expect(updateContactMock).toHaveBeenCalledWith(
        expect.objectContaining({
          force_human: false,
        }),
      );

      // 3. Contato re-autorizado para a IA
      expect(mockAutorizarContato).toHaveBeenCalledWith(
        mockAdmin,
        expect.objectContaining({
          organizationId: ORG_ID,
          contactId: CONTACT_ID,
          reason: "retomada_timeout_inatividade",
        }),
      );

      // 4. Evento de resolução emitido
      expect(rpcMock).toHaveBeenCalledWith(
        "emit_event",
        expect.objectContaining({
          p_event_type: "ai.handoff_resolved",
          p_entity_id: CONV_ID,
        }),
      );
    });
  });
});
