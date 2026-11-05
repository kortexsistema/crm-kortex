import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface TelemetryRecord {
  organization_id: string | null;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_cents: number | null;
  latency_ms: number;
  status: "ok" | "erro";
  error_code?: string | null;
  error_message?: string | null;
  http_status?: number | null;
}

const llmCallsInserts: TelemetryRecord[] = [];
let insertShouldFail = false;
const VALID_ORG_ID = "a0000000-0000-4000-8000-000000000002";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "llm_calls") {
        return {
          insert: vi.fn(async (payload: TelemetryRecord) => {
            if (insertShouldFail) {
              throw new Error("DB error inserting llm_calls");
            }
            llmCallsInserts.push(payload);
            return { data: null, error: null };
          }),
        };
      }
      if (tabela === "organizations") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain,
          eq: (_col: string, val: string) => {
            const data = val === VALID_ORG_ID ? { id: val } : null;
            return {
              maybeSingle: async () => ({ data, error: null }),
              single: async () => ({ data, error: null }),
            };
          },
        };
        return chain;
      }
      if (tabela === "agent_llm_pricing") {
        return {
          select: async () => ({
            data: [
              {
                model_prefix: "gpt-4o-mini",
                provider: "openai",
                input_usd_per_mtok: 0.15,
                output_usd_per_mtok: 0.6,
                cache_read_usd_per_mtok: 0.075,
                cache_write_usd_per_mtok: 0,
              },
            ],
            error: null,
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 14 })),
}));

vi.mock("@/lib/agent-engine/edge/llm/pricing", () => ({
  costCents: vi.fn(async () => 3), // Retorna 3 centavos fixos no mock
}));

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => `mocked-openai-${model}`),
}));

import { POST, _setDemoChatTelemetryHookForTests } from "@/app/api/public/demo-chat/route";

describe("Telemetria da rota pública Demo Chat (/api/public/demo-chat)", () => {
  const capturedHooks: TelemetryRecord[] = [];

  beforeEach(() => {
    llmCallsInserts.length = 0;
    capturedHooks.length = 0;
    insertShouldFail = false;

    _setDemoChatTelemetryHookForTests((payload) => {
      capturedHooks.push(payload as unknown as TelemetryRecord);
    });

    mockStreamText.mockReset().mockImplementation(async (opts: {
      onFinish?: (event: { usage: { promptTokens: number; completionTokens: number } }) => Promise<void>;
    }) => {
      const usagePromise = Promise.resolve({
        promptTokens: 120,
        completionTokens: 35,
      });

      // Simula término do stream invocando onFinish
      if (opts.onFinish) {
        setTimeout(() => {
          opts.onFinish?.({
            usage: {
              promptTokens: 120,
              completionTokens: 35,
            },
          });
        }, 10);
      }

      return {
        toTextStreamResponse: () => new Response("simulated stream", { status: 200 }),
        usage: usagePromise,
      };
    });
  });

  it("registra telemetria em llm_calls quando requisição traz tenant legítimo e validado", async () => {
    const req = new NextRequest("http://localhost:3000/api/public/demo-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": VALID_ORG_ID,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Olá, gostaria de saber os horários" }],
        niche: "veiculos",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Aguarda callback assíncrono do onFinish
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capturedHooks).toHaveLength(1);
    expect(capturedHooks[0]).toMatchObject({
      organization_id: VALID_ORG_ID,
      purpose: "demo_chat",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 120,
      output_tokens: 35,
      cost_cents: 3,
      status: "ok",
    });

    expect(llmCallsInserts).toHaveLength(1);
    expect(llmCallsInserts[0]).toMatchObject({
      organization_id: VALID_ORG_ID,
      purpose: "demo_chat",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 120,
      output_tokens: 35,
      cost_cents: 3,
      status: "ok",
    });
  });

  it("gera telemetria auditável sem tentar insert em llm_calls quando usuário é anônimo (sem tenant)", async () => {
    const req = new NextRequest("http://localhost:3000/api/public/demo-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Qual o cardápio de hoje?" }],
        niche: "restaurante",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // O hook de telemetria auditável captura os tokens e o custo estimado
    expect(capturedHooks).toHaveLength(1);
    expect(capturedHooks[0]).toMatchObject({
      organization_id: null,
      purpose: "demo_chat",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 120,
      output_tokens: 35,
      cost_cents: 3,
      status: "ok",
    });

    // MAS llm_calls não recebe insert com organization_id nulo/falso
    expect(llmCallsInserts).toHaveLength(0);
  });

  it("rejeita tenant id inexistente no banco e trata como anônimo sem violar FK", async () => {
    const req = new NextRequest("http://localhost:3000/api/public/demo-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": "b0000000-0000-4000-8000-000000000099",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Mensagem teste" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capturedHooks).toHaveLength(1);
    expect(capturedHooks[0].organization_id).toBeNull();
    expect(llmCallsInserts).toHaveLength(0);
  });

  it("registra telemetria de erro quando streamText falha", async () => {
    mockStreamText.mockRejectedValueOnce(new Error("OpenAI API Outage (503)"));

    const req = new NextRequest("http://localhost:3000/api/public/demo-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": VALID_ORG_ID,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Teste de erro" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    expect(capturedHooks).toHaveLength(1);
    expect(capturedHooks[0]).toMatchObject({
      purpose: "demo_chat",
      provider: "openai",
      model: "gpt-4o-mini",
      status: "erro",
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(capturedHooks[0].error_message).toContain("OpenAI API Outage");

    expect(llmCallsInserts).toHaveLength(1);
    expect(llmCallsInserts[0]).toMatchObject({
      purpose: "demo_chat",
      status: "erro",
      organization_id: VALID_ORG_ID,
    });
  });

  it("falha na inserção da telemetria não quebra a resposta de streaming para o cliente", async () => {
    insertShouldFail = true;

    const req = new NextRequest("http://localhost:3000/api/public/demo-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": VALID_ORG_ID,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Olá" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
