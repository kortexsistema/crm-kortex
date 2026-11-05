import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { NextRequest } from "next/server";
import type { QueryResult, QueryResultRow } from "pg";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { costCents, type TokenUsage } from "@/lib/agent-engine/edge/llm/pricing";
import type { Queryable } from "@/lib/agent-engine/queue/queue";
import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SYSTEM_PROMPTS: Record<string, string> = {
  veiculos: `Você é um atendente de uma concessionária de veículos chamada Kortex Motors.
Seu objetivo é qualificar o lead: descobrir se ele quer carro zero ou seminovo, perguntar se tem um modelo em mente e coletar o nome/telefone para um vendedor ligar.
Seja rápido, simpático e direto. Mantenha as mensagens curtas (formato de WhatsApp).`,
  clinica: `Você é um atendente de uma clínica médica moderna.
Seu objetivo é agendar consultas, entender a especialidade que o paciente procura e tirar dúvidas sobre planos de saúde aceitos (Unimed, Bradesco, Amil).
Seja acolhedor e atencioso. Mensagens curtas e claras.`,
  advocacia: `Você é o assistente virtual de um prestigiado escritório de advocacia.
Seu objetivo é realizar uma triagem inicial: perguntar a área do problema (cível, trabalhista, família) e solicitar um breve resumo para passar a um advogado especialista.
Seja extremamente profissional, empático e não dê aconselhamento jurídico em nenhuma hipótese.`,
  escola: `Você é da secretaria de uma escola de ensino infantil e fundamental.
Seu objetivo é informar sobre matrículas, valores de mensalidades (entre R$800 e R$1500, dependendo da série) e agendar visitas para conhecer a escola.
Seja amigável, demonstre carinho e segurança para os pais.`,
  imobiliaria: `Você é um corretor virtual de uma imobiliária.
Seu objetivo é qualificar se o cliente busca imóvel para aluguel ou compra, qual tipo de imóvel (casa, apartamento, etc) e as regiões ou bairros de interesse.
Seja focado em entender o perfil do imóvel ideal e pedir um número para contato.`,
  estetica: `Você é atendente de uma clínica de estética de alto padrão e salão de beleza.
Seu objetivo é acolher o cliente, sugerir pacotes de tratamentos estéticos (limpeza de pele, harmonização facial, etc.), combos de beleza e agendar horários para evitar no-show.
Seja empática, acolhedora e persuasiva. Foque na autoestima e bem-estar.`,
  academia: `Você é um atendente de uma academia de ginástica focada em resultados e bem-estar.
Seu objetivo é explicar os planos disponíveis (musculação, natação, pilates, dança) e tentar agendar uma aula experimental para o cliente conhecer o espaço.
Seja muito energético, motivador, encorajador e amigável.`,
  petshop: `Você é o atendente virtual de um Pet Shop e Clínica Veterinária.
Seu objetivo é agendar serviços de banho e tosa, enviar lembretes ou tirar dúvidas sobre vacinação e informar sobre produtos e rações disponíveis.
Seja extremamente carinhoso e atencioso com os pets, e muito prestativo e paciente com os tutores.`,
  contabilidade: `Você é um consultor virtual de um escritório de contabilidade empresarial (B2B).
Seu objetivo é fazer a triagem inicial do cliente: perguntar sobre o regime tributário (MEI, Simples Nacional, Lucro Presumido, etc.), qualificar a demanda corporativa e direcionar para uma reunião de proposta comercial com um especialista.
Seja extremamente profissional, claro, objetivo e demonstre autoridade técnica.`,
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export interface DemoChatTelemetryPayload {
  organization_id: string | null;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number | null;
  latency_ms: number;
  status: "ok" | "erro";
  error_code?: string | null;
  error_message?: string | null;
  http_status?: number | null;
}

/** Hook global de teste para validar interceptações em suites unitárias. */
let _testTelemetryHook: ((payload: DemoChatTelemetryPayload) => void) | null = null;

export function _setDemoChatTelemetryHookForTests(
  fn: ((payload: DemoChatTelemetryPayload) => void) | null,
): void {
  _testTelemetryHook = fn;
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  const modelId = "gpt-4o-mini";
  const provider = "openai";
  let telemetriaGravada = false;

  // 1. Resolução segura de tenant legítimo quando disponível
  const candidateOrgId = req.headers.get("x-organization-id");
  let validOrgId: string | null = null;
  if (candidateOrgId && UUID_REGEX.test(candidateOrgId)) {
    try {
      const admin = createAdminClient();
      const { data: orgCheck } = await admin
        .from("organizations")
        .select("id")
        .eq("id", candidateOrgId)
        .maybeSingle();
      if (orgCheck?.id) {
        validOrgId = orgCheck.id;
      }
    } catch {
      validOrgId = null;
    }
  }

  const registrarTelemetria = async (
    status: "ok" | "erro",
    tokens: { promptTokens: number; completionTokens: number; cachedTokens?: number },
    err?: unknown,
  ) => {
    if (telemetriaGravada) return;
    telemetriaGravada = true;
    const latencyMs = Date.now() - startMs;

    let cost: number | null = null;
    if (tokens.promptTokens > 0 || tokens.completionTokens > 0) {
      try {
        const db = criarQueryableSupabase();
        const usage: TokenUsage = {
          inputTokens: tokens.promptTokens,
          outputTokens: tokens.completionTokens,
          cacheReadTokens: tokens.cachedTokens ?? 0,
          cacheWriteTokens: 0,
        };
        cost = await costCents(db, modelId, usage, provider);
      } catch {
        cost = null;
      }
    }

    const norm = err ? normalizarErro(err) : null;
    const payload: DemoChatTelemetryPayload = {
      organization_id: validOrgId,
      purpose: "demo_chat",
      provider,
      model: modelId,
      input_tokens: tokens.promptTokens,
      output_tokens: tokens.completionTokens,
      cost_cents: cost,
      latency_ms: latencyMs,
      status,
      error_code: norm?.error_code ?? null,
      error_message: norm?.error_message ? norm.error_message.slice(0, 500) : null,
      http_status: norm?.http_status ?? (status === "ok" ? 200 : 500),
    };

    if (_testTelemetryHook) {
      try {
        _testTelemetryHook(payload);
      } catch {
        // hook de teste não pode quebrar a requisição
      }
    }

    // Se houver tenant legítimo no banco, persiste em llm_calls
    if (validOrgId) {
      try {
        const admin = createAdminClient();
        await admin.from("llm_calls").insert({
          organization_id: validOrgId,
          purpose: "demo_chat",
          provider,
          model: modelId,
          input_tokens: tokens.promptTokens,
          output_tokens: tokens.completionTokens,
          cache_read_tokens: tokens.cachedTokens ?? 0,
          cache_write_tokens: 0,
          cost_cents: cost,
          latency_ms: latencyMs,
          status,
          error_code: payload.error_code ?? null,
          error_message: payload.error_message ?? null,
          http_status: payload.http_status ?? null,
        });
      } catch (telemetryErr) {
        logger.warn("[demo-chat] falha ao gravar telemetria em llm_calls", {
          error: telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr),
        });
      }
    } else {
      // Sem tenant legítimo: log estruturado auditável sem violar a constraint NOT NULL do banco
      logger.info("[demo-chat] telemetria de consumo público (sem tenant associado)", {
        purpose: "demo_chat",
        provider,
        model: modelId,
        input_tokens: tokens.promptTokens,
        output_tokens: tokens.completionTokens,
        cost_cents: cost,
        latency_ms: latencyMs,
        status,
        error_code: payload.error_code ?? null,
      });
    }
  };

  try {
    const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const bucket = `demo_chat:${ip}`;

    // Limite da demonstração: 15 mensagens por hora por IP (para evitar uso abusivo da LLM via Sandbox)
    const limitResult = await checkRateLimit(bucket, 15, 3600);

    if (!limitResult.allowed) {
      return new Response("Muitas requisições. Volte mais tarde.", {
        status: 429,
      });
    }

    const body = (await req.json()) as { messages?: unknown; niche?: string };
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const systemPrompt = (body.niche && SYSTEM_PROMPTS[body.niche]) || SYSTEM_PROMPTS["veiculos"]!;

    let result: Awaited<ReturnType<typeof streamText>>;
    try {
      result = await streamText({
        model: openai(modelId),
        system: systemPrompt,
        messages: messages as Parameters<typeof streamText>[0]["messages"],
        temperature: 0.7,
        onFinish: async (event) => {
          const raw = event.usage as Record<string, unknown> | undefined;
          const inputTokens = typeof raw?.inputTokens === "number" ? raw.inputTokens : (raw?.promptTokens as number | undefined) ?? 0;
          const outputTokens = typeof raw?.outputTokens === "number" ? raw.outputTokens : (raw?.completionTokens as number | undefined) ?? 0;
          await registrarTelemetria("ok", {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
          });
        },
      });
    } catch (streamErr) {
      await registrarTelemetria("erro", { promptTokens: 0, completionTokens: 0 }, streamErr);
      throw streamErr;
    }

    // Instrumentação sem depender exclusivamente de onFinish:
    // result.usage é uma Promise que o AI SDK resolve com o LanguageModelUsage completo
    void Promise.resolve(result.usage)
      .then(async (u) => {
        const raw = u as Record<string, unknown> | undefined;
        const inputTokens = typeof raw?.inputTokens === "number" ? raw.inputTokens : (raw?.promptTokens as number | undefined) ?? 0;
        const outputTokens = typeof raw?.outputTokens === "number" ? raw.outputTokens : (raw?.completionTokens as number | undefined) ?? 0;
        await registrarTelemetria("ok", {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
        });
      })
      .catch(async (streamErr: unknown) => {
        await registrarTelemetria("erro", { promptTokens: 0, completionTokens: 0 }, streamErr);
      });

    return result.toTextStreamResponse();
  } catch (err: unknown) {
    logger.error("[demo-chat] erro no processamento da requisição", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Internal Server Error", { status: 500 });
  }
}
