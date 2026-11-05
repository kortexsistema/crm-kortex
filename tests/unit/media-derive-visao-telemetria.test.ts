import { beforeEach, describe, expect, it, vi } from "vitest";

const llmCallsInserts: Record<string, unknown>[] = [];
let insertShouldFail = false;

const messageRow = {
  id: "msg_img_1",
  organization_id: "a0000000-0000-4000-8000-000000000001",
  type: "image",
  media_mime: "image/jpeg",
  media_storage_path: "org1/conv1/photo.jpg",
  media_derived_status: null as string | null,
};

const bindingDeVisao = {
  provider: "openai",
  model_id: "gpt-4o-mini",
  credential_id: null,
};

const updateEqMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "llm_calls") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            if (insertShouldFail) {
              throw new Error("DB Connection Error on llm_calls");
            }
            llmCallsInserts.push(payload);
            return { data: null, error: null };
          }),
        };
      }
      const linha =
        tabela === "ai_purpose_bindings"
          ? bindingDeVisao
          : tabela === "messages"
            ? messageRow
            : null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const terminais: any = {
        maybeSingle: async () => ({ data: linha, error: null }),
        single: async () => ({ data: linha, error: null }),
        update: (patch: Record<string, unknown>) => {
          updateEqMock(patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        insert: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: linha ? [linha] : [], error: null }).then(resolve),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(terminais, {
        get: (alvo, prop) =>
          prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain,
      });
      return chain;
    },
    storage: {
      from: () => ({ download: downloadMock }),
    },
  }),
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("@/lib/agent-engine/edge/llm/pricing", () => ({
  costCents: vi.fn(async (_pool: unknown, _model: string, usage: { inputTokens: number; outputTokens: number }) => {
    return usage.inputTokens > 0 || usage.outputTokens > 0 ? 5 : 0;
  }),
}));

vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: vi.fn(async () => ({
    provider: "openai",
    apiKey: "sk-test-vision-key",
    defaultModel: "gpt-4o",
    params: {},
    enabledModels: [],
    orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
    orcamentoIndisponivelPorque: null,
  })),
}));

import { deriveMessageMedia } from "@/workers/media-derive-worker";

function makeImageEvent(attempts = 0) {
  return {
    id: "ev_img_1",
    organization_id: "a0000000-0000-4000-8000-000000000001",
    event_type: "media.derive_requested",
    entity_kind: "message",
    entity_id: "msg_img_1",
    payload: { message_id: "msg_img_1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

describe("Telemetria de Visão / Imagens (media-derive-worker)", () => {
  beforeEach(() => {
    llmCallsInserts.length = 0;
    insertShouldFail = false;
    updateEqMock.mockReset();
    downloadMock.mockReset().mockResolvedValue({
      data: new Blob([new Uint8Array([137, 80, 78, 71])]),
      error: null,
    });
    mockGenerateText.mockReset().mockResolvedValue({
      text: "Um recibo de pagamento no valor de R$ 150,00",
      usage: {
        promptTokens: 850,
        completionTokens: 45,
        promptTokensDetails: {
          cachedTokens: 128,
        },
      },
    });
  });

  it("registra telemetria de sucesso em llm_calls com purpose visao_de_imagem, tokens reais e custo", async () => {
    const res = await deriveMessageMedia(makeImageEvent());
    expect(res.status).toBe("ok");

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(llmCallsInserts).toHaveLength(1);

    const call = llmCallsInserts[0];
    expect(call).toMatchObject({
      organization_id: "a0000000-0000-4000-8000-000000000001",
      purpose: "visao_de_imagem",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 850,
      output_tokens: 45,
      cache_read_tokens: 128,
      cache_write_tokens: 0,
      cost_cents: 5,
      status: "ok",
    });
    expect(typeof call.latency_ms).toBe("number");
    expect(call.latency_ms).toBeGreaterThanOrEqual(0);

    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_derived_status: "ready",
        media_derived_text: "Um recibo de pagamento no valor de R$ 150,00",
      }),
    );
  });

  it("registra telemetria de erro em llm_calls e marca status de erro quando generateText falha", async () => {
    const apiError = new Error("Rate limit exceeded (429)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).status = 429;
    mockGenerateText.mockRejectedValueOnce(apiError);

    const res = await deriveMessageMedia(makeImageEvent(4)); // 5a tentativa (última)
    expect(res.status).toBe("error");
    expect(res.detail).toContain("Rate limit exceeded (429)");

    expect(llmCallsInserts).toHaveLength(1);
    const call = llmCallsInserts[0];
    expect(call).toMatchObject({
      organization_id: "a0000000-0000-4000-8000-000000000001",
      purpose: "visao_de_imagem",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 0,
      output_tokens: 0,
      status: "erro",
      http_status: 429,
    });
    expect(call.error_message).toContain("Rate limit exceeded");
  });

  it("falha na inserção da telemetria NÃO interrompe a derivação da imagem", async () => {
    insertShouldFail = true;

    const res = await deriveMessageMedia(makeImageEvent());
    expect(res.status).toBe("ok");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_derived_status: "ready",
        media_derived_text: "Um recibo de pagamento no valor de R$ 150,00",
      }),
    );
  });
});
