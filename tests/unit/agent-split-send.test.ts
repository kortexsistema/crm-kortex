import { describe, expect, it, vi } from "vitest";

import { sendInBubbles } from "@/lib/agent-engine/agent/split-message";

describe("sendInBubbles", () => {
  it("split off -> 1 envio com o corpo inteiro", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const esperarBolha = vi.fn(async () => undefined);
    const out = await sendInBubbles("um texto qualquer", { enabled: false, maxChars: 600, send, esperarBolha });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("um texto qualquer");
    expect(out.kind).toBe("sent");
  });

  it("split on + texto longo -> N envios com jitter entre eles", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const esperarBolha = vi.fn(async () => undefined);
    const text = "Primeira ideia aqui.\n\nSegunda ideia aqui.\n\nTerceira ideia aqui.";
    const out = await sendInBubbles(text, { enabled: true, maxChars: 25, send, esperarBolha });
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(esperarBolha).toHaveBeenCalled(); // atraso entre bolhas
    expect(out.kind).toBe("sent");
  });

  it("para no primeiro envio nao-sent (veto/falha) e devolve esse outcome", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "sent", messageId: "m1" })
      .mockResolvedValueOnce({ kind: "blocked" });
    const esperarBolha = vi.fn(async () => undefined);
    const text = "Bolha um aqui.\n\nBolha dois aqui.\n\nBolha tres aqui.";
    const out = await sendInBubbles(text, { enabled: true, maxChars: 20, send, esperarBolha });
    expect(out.kind).toBe("blocked");
    expect(send).toHaveBeenCalledTimes(2); // parou na 2a
  });
});
