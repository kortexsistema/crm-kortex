/**
 * Testes unitários para a Etapa 2: Instrumentação de Telemetria de Custos de Embeddings RAG em `llm_calls`.
 *
 * Cobertura obrigatória:
 * 1. Chamada de embedding bem-sucedida com usage disponível
 * 2. Chamada sem usage retornado pelo provider (não inventar tokens nem custo)
 * 3. Falha na chamada de embedding (registra erro com status: 'erro')
 * 4. Falha na asserção de dimensão preservando tokens e custo medidos
 * 5. Falha na gravação de telemetria sem interromper a operação principal
 * 6. Identificação correta de provider e modelo
 * 7. Associação ao tenant correto (organizationId)
 * 8. Ausência de registros duplicados (exatamente 1 registro por chamada)
 * 9. Cálculo de custo usando a implementação da Etapa 1
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import type { Queryable } from "@/lib/agent-engine/queue/queue";
import { _resetAgentPricingCacheForTests } from "@/lib/agent-engine/edge/llm/pricing";
import { embedText, type LlmCallTelemetryRecord } from "@/lib/ai/embed";
import type * as EmbeddingsChaveModule from "@/lib/ai/embeddings/chave";
import type { ModelId } from "@/lib/ai/gateway";

const embedSpy = vi.fn();
vi.mock("ai", () => ({
  embed: (args: unknown) => embedSpy(args),
}));

let chaveMock: () => unknown;
vi.mock("@/lib/ai/embeddings/chave", async () => {
  const real =
    await vi.importActual<typeof EmbeddingsChaveModule>("@/lib/ai/embeddings/chave");
  return {
    ...real,
    resolverChaveDeEmbedding: async () => chaveMock(),
  };
});

// Mock do supabase admin para capturar inserções reais se necessário
const supabaseInsertSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "llm_calls") {
        return {
          insert: async (row: unknown) => {
            supabaseInsertSpy(row);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          data: [],
          error: null,
        }),
      };
    },
  }),
}));

const ORG_ID = "00000000-0000-0000-0000-000000000001";

function fakePricingDb(): Queryable {
  const rows = [
    {
      model_prefix: "text-embedding-3-small",
      provider: "openai",
      input_usd_per_mtok: 0.02,
      output_usd_per_mtok: 0.0,
      cache_read_usd_per_mtok: 0.0,
      cache_write_usd_per_mtok: 0.0,
    },
    {
      model_prefix: "text-embedding-3-large",
      provider: "openai",
      input_usd_per_mtok: 0.13,
      output_usd_per_mtok: 0.0,
      cache_read_usd_per_mtok: 0.0,
      cache_write_usd_per_mtok: 0.0,
    },
  ];

  return {
    query: async <R extends QueryResultRow>(_sql: string): Promise<QueryResult<R>> => ({
      rows: rows as unknown as R[],
      command: "SELECT",
      rowCount: rows.length,
      oid: 0,
      fields: [],
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAgentPricingCacheForTests();
  embedSpy.mockReset();
  embedSpy.mockResolvedValue({
    embedding: Array.from({ length: 1536 }, (_, i) => i / 1536),
    usage: { tokens: 100 },
  });
  chaveMock = () => ({
    apiKey: "sk-teste-chave",
    baseUrl: null,
    viaGateway: false,
    origem: "credencial_da_organizacao",
    rotulo: "Chave de Teste",
    avisos: [],
  });
});

describe("Etapa 2 — Instrumentação de Telemetria de Embeddings RAG", () => {
  it("chamada de embedding bem-sucedida registra telemetria com usage e custo em llm_calls", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    // 100.000 tokens de text-embedding-3-small ($0.02 / 1M tokens)
    // Custo USD: 100.000 * 0.02 / 1.000.000 = $0.002
    // Custo em cents: 0.2 cents
    embedSpy.mockResolvedValueOnce({
      embedding: Array.from({ length: 1536 }, () => 0.1),
      usage: { tokens: 100_000 },
    });

    const resultado = await embedText("texto para indexação", {
      organizationId: ORG_ID,
      telemetryDb: db,
      onRecordTelemetry: (rec) => {
        telemetria.push(rec);
      },
    });

    expect(resultado.embedding).toHaveLength(1536);
    expect(resultado.promptTokens).toBe(100_000);
    expect(telemetria).toHaveLength(1);

    const reg = telemetria[0];
    expect(reg?.organization_id).toBe(ORG_ID);
    expect(reg?.purpose).toBe("embedding_indexar");
    expect(reg?.provider).toBe("openai");
    expect(reg?.model).toBe("openai/text-embedding-3-small");
    expect(reg?.input_tokens).toBe(100_000);
    expect(reg?.output_tokens).toBe(0);
    expect(reg?.status).toBe("ok");
    expect(reg?.cost_cents).not.toBeNull();
    expect(reg?.cost_cents).toBeCloseTo(0.2, 5);
  });

  it("chamada com ponto explícito registra purpose correto (ex: embedding_consultar)", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    await embedText("pergunta do usuário", {
      organizationId: ORG_ID,
      ponto: "embedding_consultar",
      telemetryDb: db,
      onRecordTelemetry: (rec) => {
        telemetria.push(rec);
      },
    });

    expect(telemetria).toHaveLength(1);
    expect(telemetria[0]?.purpose).toBe("embedding_consultar");
  });

  it("chamada sem usage do provider não inventa tokens nem custo (input_tokens: 0, cost_cents: null)", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    embedSpy.mockResolvedValueOnce({
      embedding: Array.from({ length: 1536 }, () => 0.2),
      usage: undefined,
    });

    const resultado = await embedText("sem tokens", {
      organizationId: ORG_ID,
      telemetryDb: db,
      onRecordTelemetry: (rec) => {
        telemetria.push(rec);
      },
    });

    expect(resultado.promptTokens).toBe(0);
    expect(telemetria).toHaveLength(1);
    expect(telemetria[0]?.input_tokens).toBe(0);
    expect(telemetria[0]?.cost_cents).toBeNull();
    expect(telemetria[0]?.status).toBe("ok");
  });

  it("falha na chamada à API registra telemetria com status 'erro' e re-lança o erro", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    embedSpy.mockRejectedValueOnce(new Error("Rate limit exceeded na OpenAI"));

    await expect(
      embedText("chamada que estoura limite", {
        organizationId: ORG_ID,
        telemetryDb: db,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      }),
    ).rejects.toThrow("Rate limit exceeded na OpenAI");

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.status).toBe("erro");
    expect(reg?.organization_id).toBe(ORG_ID);
    expect(reg?.error_message).toContain("Rate limit exceeded na OpenAI");
  });

  it("se a chamada falhar após retornar usage (ex: dimensão inválida), preserva tokens e custo no registro de erro", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    // OpenAI respondeu 50.000 tokens, mas vetor veio com 512 dims em vez de 1536
    embedSpy.mockResolvedValueOnce({
      embedding: Array.from({ length: 512 }, () => 0.1),
      usage: { promptTokens: 50_000 },
    });

    await expect(
      embedText("documento que devolve dimensão errada", {
        organizationId: ORG_ID,
        telemetryDb: db,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      }),
    ).rejects.toThrow(/512 dimensões, esperado 1536/);

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.status).toBe("erro");
    expect(reg?.error_code).toBe("dimensao_invalida");
    expect(reg?.input_tokens).toBe(50_000);
    // 50.000 * 0.02 / 1M = $0.001 -> 0.1 cents
    expect(reg?.cost_cents).toBeCloseTo(0.1, 5);
  });

  it("falha na gravação da telemetria NÃO interrompe a operação principal de embedding", async () => {
    const db = fakePricingDb();

    const resultado = await embedText("texto normal", {
      organizationId: ORG_ID,
      telemetryDb: db,
      onRecordTelemetry: () => {
        throw new Error("Falha catastrófica de conexão com o banco de telemetria");
      },
    });

    // O embedding ainda é retornado com sucesso absoluto!
    expect(resultado.embedding).toHaveLength(1536);
    expect(resultado.promptTokens).toBe(100);
  });

  it("evita registros duplicados: gera no máximo 1 registro por invocação", async () => {
    let contagemRegistros = 0;
    const db = fakePricingDb();

    await embedText("chamada única", {
      organizationId: ORG_ID,
      telemetryDb: db,
      onRecordTelemetry: () => {
        contagemRegistros++;
      },
    });

    expect(contagemRegistros).toBe(1);
  });

  it("identifica corretamente provider 'openai' e modelo para text-embedding-3-large", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];
    const db = fakePricingDb();

    // 1M tokens de text-embedding-3-large ($0.13 / 1M tokens -> 13 cents)
    embedSpy.mockResolvedValueOnce({
      embedding: Array.from({ length: 1536 }, () => 0.1),
      usage: { totalTokens: 1_000_000 },
    });

    await embedText("documento denso", {
      organizationId: ORG_ID,
      model: "openai/text-embedding-3-large" as unknown as ModelId,
      telemetryDb: db,
      onRecordTelemetry: (rec) => {
        telemetria.push(rec);
      },
    });

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.provider).toBe("openai");
    expect(reg?.model).toBe("openai/text-embedding-3-large");
    expect(reg?.input_tokens).toBe(1_000_000);
    expect(reg?.cost_cents).toBeCloseTo(13, 5);
  });
});
