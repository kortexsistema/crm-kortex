/**
 * Embedding do RAG — indexação e busca, o mesmo modelo dos dois lados.
 *
 * A chave vem de `lib/ai/embeddings/chave.ts`, que resolve pela organização:
 * binding do ponto → credencial OpenAI da org → gateway da instalação → chave
 * da instalação. Até a 0181 este arquivo lia SÓ `process.env`, e o efeito era o
 * pior possível para quem instala: cadastrar a chave da OpenAI pela tela não
 * habilitava a base de conhecimento, enquanto duas telas do produto prometiam
 * que sim.
 *
 * Instrumentado na Etapa 2 para telemetria em `llm_calls` com precificação da Etapa 1.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import type { QueryResult, QueryResultRow } from "pg";

import {
  DIMENSOES_DO_EMBEDDING,
  MODELO_DE_EMBEDDING,
  resolverChaveDeEmbedding,
  type ChaveDeEmbedding,
  type PontoDeEmbedding,
} from "@/lib/ai/embeddings/chave";
import { gatewayHeaders, type ModelId } from "@/lib/ai/gateway";
import { costCents, type TokenUsage } from "@/lib/agent-engine/edge/llm/pricing";
import type { Queryable } from "@/lib/agent-engine/queue/queue";
import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LlmCallTelemetryRecord {
  organization_id: string;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_cents: number | null;
  latency_ms: number | null;
  status: "ok" | "erro";
  error_code?: string | null;
  error_message?: string | null;
}

export interface EmbedOptions {
  organizationId: string;
  /**
   * Qual ponto de IA está chamando. Muda apenas de QUAL binding a chave sai —
   * o modelo é o mesmo por contrato, e divergir quebraria o recall em silêncio.
   */
  ponto?: PontoDeEmbedding;
  /**
   * Chave já resolvida. Existe para o indexador resolver UMA vez e embedar N
   * chunks: sem isto, indexar um documento de 200 trechos decifraria a
   * credencial 200 vezes.
   */
  chave?: ChaveDeEmbedding;
  model?: ModelId;
  /** Injeção opcional de Queryable para consulta de precificação em testes. */
  telemetryDb?: Queryable;
  /** Hook opcional para interceptação de telemetria em testes. */
  onRecordTelemetry?: (record: LlmCallTelemetryRecord) => Promise<void> | void;
}

export interface EmbedResult {
  embedding: number[];
  promptTokens: number;
  model: string;
}

/** Falta de chave é um ESTADO do tenant, não um acidente: tipo próprio para quem
 *  chama poder mostrar a tela certa em vez de repetir um erro genérico. */
export class SemChaveDeEmbeddingError extends Error {
  readonly code = "embedding_sem_chave";
  constructor(readonly organizationId: string) {
    super(
      "Esta organização não tem chave da OpenAI para indexar nem consultar o material. " +
        "Cadastre uma em Credenciais, ou defina OPENAI_API_KEY na instalação.",
    );
    this.name = "SemChaveDeEmbeddingError";
  }
}

/**
 * Deriva o provedor do modelo de embedding (OpenAI por padrão no contrato).
 */
export function derivarProviderEmbedding(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.startsWith("openai/") || m.startsWith("text-embedding")) return "openai";
  if (m.startsWith("anthropic/") || m.startsWith("claude")) return "anthropic";
  if (m.startsWith("google/") || m.startsWith("gemini")) return "google";
  if (m.includes("/")) return m.split("/")[0] ?? "openai";
  return "openai";
}

/**
 * Cria adapter Queryable sobre o Supabase admin client para ler agent_llm_pricing.
 */
function criarQueryableSupabase(): Queryable {
  return {
    query: async <R extends QueryResultRow = QueryResultRow>(_sql: string): Promise<QueryResult<R>> => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("agent_llm_pricing")
        .select(
          "model_prefix, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok, provider",
        );
      if (error) throw new Error(error.message);
      return {
        rows: (data ?? []) as unknown as R[],
        rowCount: data?.length ?? 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };
}

/**
 * Calcula custo de embedding em cents usando a lógica e tabela da Etapa 1.
 */
async function calcularCustoEmbedding(
  db: Queryable,
  modelId: string,
  provider: string,
  tokens: number,
): Promise<number | null> {
  try {
    const usage: TokenUsage = {
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    return await costCents(db, modelId, usage, provider);
  } catch (err) {
    logger.warn("[embedText] erro ao calcular custo de embedding", {
      modelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Grava telemetria em `llm_calls` de forma segura (falha não interrompe RAG).
 */
async function salvarTelemetriaEmbedding(
  record: LlmCallTelemetryRecord,
  opts?: {
    onRecordTelemetry?: (record: LlmCallTelemetryRecord) => Promise<void> | void;
  },
): Promise<void> {
  try {
    if (opts?.onRecordTelemetry) {
      await opts.onRecordTelemetry(record);
      return;
    }
    const admin = createAdminClient();
    const { error } = await admin.from("llm_calls").insert({
      organization_id: record.organization_id,
      purpose: record.purpose,
      provider: record.provider,
      model: record.model,
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      cache_read_tokens: record.cache_read_tokens,
      cache_write_tokens: record.cache_write_tokens,
      cost_cents: record.cost_cents,
      latency_ms: record.latency_ms,
      status: record.status,
      error_code: record.error_code ?? null,
      error_message: record.error_message ? record.error_message.slice(0, 500) : null,
    });
    if (error) {
      logger.warn("[embedText] falha ao salvar telemetria em llm_calls", {
        error: error.message,
        organizationId: record.organization_id,
        purpose: record.purpose,
      });
    }
  } catch (err) {
    logger.warn("[embedText] exceção ao salvar telemetria em llm_calls", {
      error: err instanceof Error ? err.message : String(err),
      organizationId: record.organization_id,
    });
  }
}

export async function embedText(
  content: string,
  opts: EmbedOptions,
): Promise<EmbedResult> {
  const chave =
    opts.chave ?? (await resolverChaveDeEmbedding(opts.organizationId, opts.ponto));
  if (!chave) {
    throw new SemChaveDeEmbeddingError(opts.organizationId);
  }

  const modelId = String(opts.model ?? MODELO_DE_EMBEDDING);
  const purpose = opts.ponto ?? "embedding_indexar";
  const provider = derivarProviderEmbedding(modelId);
  const db = opts.telemetryDb ?? criarQueryableSupabase();

  // COM gateway: a string `openai/text-embedding-3-small` é roteada por ele, que
  // lê `AI_GATEWAY_API_KEY` do process.env. Headers vão junto p/ observabilidade
  // por tenant + ZDR.
  //
  // SEM gateway: precisa ser o provider OpenAI EXPLÍCITO. Passar a string com
  // barra aqui não cai no OpenAI direto — no AI SDK, id com barra é resolvido
  // pelo gateway da Vercel mesmo sem chave, entrando no plano anônimo, cujo teto
  // devolve `GatewayRateLimitError` e derruba a busca na base de conhecimento.
  const resolvido = chave.viaGateway
    ? modelId
    : createOpenAI({
        apiKey: chave.apiKey ?? "",
        ...(chave.baseUrl ? { baseURL: chave.baseUrl } : {}),
      }).textEmbeddingModel(modelId.replace(/^openai\//, ""));

  const startMs = Date.now();
  let result: Awaited<ReturnType<typeof embed>>;
  let telemetriaRegistrada = false;

  try {
    result = await embed({
      model: resolvido,
      value: content,
      headers: chave.viaGateway
        ? gatewayHeaders({ organizationId: opts.organizationId })
        : undefined,
    });
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const errUsage = (err as { usage?: { tokens?: number; promptTokens?: number; totalTokens?: number } })?.usage;
    const tokensFromErr = errUsage?.tokens ?? errUsage?.promptTokens ?? errUsage?.totalTokens;

    let cost: number | null = null;
    let tokensValidos = 0;
    if (typeof tokensFromErr === "number" && !isNaN(tokensFromErr)) {
      tokensValidos = tokensFromErr;
      cost = await calcularCustoEmbedding(db, modelId, provider, tokensValidos);
    }

    const norm = normalizarErro(err);
    telemetriaRegistrada = true;
    await salvarTelemetriaEmbedding(
      {
        organization_id: opts.organizationId,
        purpose,
        provider,
        model: modelId,
        input_tokens: tokensValidos,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cents: cost,
        latency_ms: latencyMs,
        status: "erro",
        error_code: norm.error_code,
        error_message: norm.error_message,
      },
      { onRecordTelemetry: opts.onRecordTelemetry },
    );
    throw err;
  }

  const latencyMs = Date.now() - startMs;

  // Extração estrita de tokens reais retornados pelo provider
  const rawUsage = result.usage as { tokens?: number; promptTokens?: number; totalTokens?: number } | undefined;
  const rawTokens = rawUsage?.tokens ?? rawUsage?.promptTokens ?? rawUsage?.totalTokens;
  const hasUsage = typeof rawTokens === "number" && !isNaN(rawTokens);
  const promptTokens = hasUsage ? rawTokens : 0;

  let cost: number | null = null;
  if (hasUsage) {
    cost = await calcularCustoEmbedding(db, modelId, provider, promptTokens);
  }

  // Dimensão asserida a cada chamada: divergir de modelo quebra o recall em
  // SILÊNCIO (os vetores deixam de ser comparáveis), e uma chamada recusada é
  // infinitamente melhor que um acervo que responde errado com nota alta.
  // Se falhar após receber tokens da OpenAI, preserva tokens e custo no registro de erro!
  if (result.embedding.length !== DIMENSOES_DO_EMBEDDING) {
    const msgErro =
      `embedding com ${result.embedding.length} dimensões, esperado ${DIMENSOES_DO_EMBEDDING} ` +
      `(pin de contrato ${modelId}) — recall quebraria em silêncio`;
    telemetriaRegistrada = true;
    await salvarTelemetriaEmbedding(
      {
        organization_id: opts.organizationId,
        purpose,
        provider,
        model: modelId,
        input_tokens: promptTokens,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cents: cost,
        latency_ms: latencyMs,
        status: "erro",
        error_code: "dimensao_invalida",
        error_message: msgErro,
      },
      { onRecordTelemetry: opts.onRecordTelemetry },
    );
    throw new Error(msgErro);
  }

  // Sucesso completo: registra a chamada exatamente uma vez
  if (!telemetriaRegistrada) {
    telemetriaRegistrada = true;
    await salvarTelemetriaEmbedding(
      {
        organization_id: opts.organizationId,
        purpose,
        provider,
        model: modelId,
        input_tokens: promptTokens,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cents: cost,
        latency_ms: latencyMs,
        status: "ok",
      },
      { onRecordTelemetry: opts.onRecordTelemetry },
    );
  }

  return { embedding: result.embedding, promptTokens, model: modelId };
}
