import { describe, expect, it } from "vitest";
import {
  PACING_DEFAULTS,
  type PacingKnobs,
} from "@/lib/agent-engine/pacing/defaults";
import {
  decidePacing,
  janelaDeEnvioAberta,
  proximaAberturaDaJanela,
} from "@/lib/agent-engine/pacing/engine";
import {
  pacingKnobsUpdateSchema,
  windowIsValid,
} from "@/lib/ai/pacing-knobs";

describe("Janela de envio com precisão de minutos", () => {
  describe("windowIsValid", () => {
    it("valida janelas com mesma hora e minutos distintos", () => {
      expect(windowIsValid(8, 8, 0, 30)).toBe(true);
      expect(windowIsValid(8, 8, 30, 30)).toBe(false);
      expect(windowIsValid(8, 8, 45, 15)).toBe(false);
    });

    it("valida janelas entre horas diferentes com minutos", () => {
      expect(windowIsValid(8, 18, 30, 0)).toBe(true);
      expect(windowIsValid(8, 18, 45, 15)).toBe(true);
      expect(windowIsValid(18, 8, 0, 30)).toBe(false);
    });

    it("mantém compatibilidade quando minutos são omitidos (default 0)", () => {
      expect(windowIsValid(8, 20)).toBe(true);
      expect(windowIsValid(20, 8)).toBe(false);
      expect(windowIsValid(8, 8)).toBe(false);
    });
  });

  describe("pacingKnobsUpdateSchema", () => {
    const basePayload = {
      channel_session_id: "11111111-1111-4111-8111-111111111111",
    };

    it("aceita minutos válidos entre 0 e 59", () => {
      const parsed = pacingKnobsUpdateSchema.safeParse({
        ...basePayload,
        window_start_hour: 8,
        window_start_minute: 30,
        window_end_hour: 18,
        window_end_minute: 45,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.window_start_minute).toBe(30);
        expect(parsed.data.window_end_minute).toBe(45);
      }
    });

    it("aceita null para reverter minutos ao padrão", () => {
      const parsed = pacingKnobsUpdateSchema.safeParse({
        ...basePayload,
        window_start_minute: null,
        window_end_minute: null,
      });
      expect(parsed.success).toBe(true);
    });

    it("recusa minutos menores que 0 ou maiores que 59", () => {
      expect(
        pacingKnobsUpdateSchema.safeParse({
          ...basePayload,
          window_start_minute: -1,
        }).success,
      ).toBe(false);

      expect(
        pacingKnobsUpdateSchema.safeParse({
          ...basePayload,
          window_end_minute: 60,
        }).success,
      ).toBe(false);
    });
  });

  describe("janelaDeEnvioAberta com minutos", () => {
    const knobs: PacingKnobs = {
      ...PACING_DEFAULTS,
      timezone: "UTC",
      allowSunday: true,
      windowStartHour: 8,
      windowStartMinute: 30,
      windowEndHour: 18,
      windowEndMinute: 15,
    };

    it("avalia corretamente antes da abertura, durante a janela e após o fechamento", () => {
      // 08:29 UTC -> fechado
      expect(janelaDeEnvioAberta(new Date("2026-10-21T08:29:59.000Z"), knobs)).toBe(false);

      // 08:30 UTC -> aberto
      expect(janelaDeEnvioAberta(new Date("2026-10-21T08:30:00.000Z"), knobs)).toBe(true);

      // 12:00 UTC -> aberto
      expect(janelaDeEnvioAberta(new Date("2026-10-21T12:00:00.000Z"), knobs)).toBe(true);

      // 18:14:59 UTC -> aberto
      expect(janelaDeEnvioAberta(new Date("2026-10-21T18:14:59.000Z"), knobs)).toBe(true);

      // 18:15:00 UTC -> fechado
      expect(janelaDeEnvioAberta(new Date("2026-10-21T18:15:00.000Z"), knobs)).toBe(false);
    });
  });

  describe("proximaAberturaDaJanela com minutos", () => {
    const knobs: PacingKnobs = {
      ...PACING_DEFAULTS,
      timezone: "UTC",
      allowSunday: true,
      windowStartHour: 8,
      windowStartMinute: 30,
      windowEndHour: 18,
      windowEndMinute: 0,
      jitterMaxMs: 0,
    };

    it("agenda para a abertura com minuto exato no mesmo dia se antes da abertura", () => {
      const now = new Date("2026-10-21T07:15:00.000Z");
      const nextOpen = proximaAberturaDaJanela(now, knobs, () => 0);
      expect(nextOpen.toISOString()).toBe("2026-10-21T08:30:00.000Z");
    });

    it("agenda para a abertura do dia seguinte se após o fechamento", () => {
      const now = new Date("2026-10-21T19:00:00.000Z");
      const nextOpen = proximaAberturaDaJanela(now, knobs, () => 0);
      expect(nextOpen.toISOString()).toBe("2026-10-22T08:30:00.000Z");
    });
  });

  describe("decidePacing formatação do motivo", () => {
    it("exibe horas e minutos no motivo quando fora da janela", () => {
      const knobs: PacingKnobs = {
        ...PACING_DEFAULTS,
        timezone: "UTC",
        allowSunday: true,
        windowStartHour: 8,
        windowStartMinute: 30,
        windowEndHour: 18,
        windowEndMinute: 45,
        jitterMaxMs: 0,
      };

      const now = new Date("2026-10-21T07:00:00.000Z");
      const decision = decidePacing({
        now,
        knobs,
        state: {
          lastSentAt: null,
          sentToday: 0,
          numberActivatedAt: null,
        },
        crmDailyLimit: null,
        rng: () => 0,
      });

      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reason).toContain("8h30");
        expect(decision.reason).toContain("18h45");
        expect(decision.nextAllowedAt).toEqual(new Date("2026-10-21T08:30:00.000Z"));
      }
    });
  });
});
