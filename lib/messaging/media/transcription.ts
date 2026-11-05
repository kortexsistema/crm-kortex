/**
 * Transcrição de áudio plugável (Onda 3). Default: API speech-to-text
 * OpenAI-compatível (Whisper) via BYOK. O derivado é texto → alimenta QUALQUER
 * modelo de chat (camada universal). Um backend mlx-whisper local implementa a
 * mesma interface para self-host em Apple Silicon (fora deste MVP).
 *
 * Instrumentado na Etapa 3 para telemetria em `llm_calls`.
 */

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
  http_status?: number | null;
}

export interface TranscriptionProvider {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

export interface TranscriptionCreds {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Identificador da organização para telemetria em llm_calls. */
  organizationId?: string;
  /** Hook opcional para interceptação de telemetria em testes unitários. */
  onRecordTelemetry?: (record: LlmCallTelemetryRecord) => Promise<void> | void;
}

const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";
const PURPOSE_TRANSCRICAO = "transcricao_de_audio";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("wav")) return "wav";
  return "bin";
}

/**
 * Deriva o provedor do modelo/baseUrl da transcrição (OpenAI por padrão).
 */
export function derivarProviderTranscricao(creds: TranscriptionCreds): string {
  const model = (creds.model ?? DEFAULT_MODEL).toLowerCase();
  if (model.includes("whisper") || !creds.baseUrl || creds.baseUrl.includes("openai.com")) {
    return "openai";
  }
  return "openai";
}

/**
 * Grava telemetria em `llm_calls` de forma resiliente.
 * Falhas na telemetria NUNCA interrompem a transcrição nem a entrega do áudio.
 */
async function salvarTelemetriaTranscricao(
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

    if (!UUID_REGEX.test(record.organization_id)) {
      logger.warn("[transcription] organization_id ausente ou inválido; telemetria em llm_calls ignorada", {
        organization_id: record.organization_id,
        purpose: record.purpose,
      });
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
      http_status: record.http_status ?? null,
    });

    if (error) {
      logger.warn("[transcription] falha ao salvar telemetria em llm_calls", {
        error: error.message,
        organizationId: record.organization_id,
        purpose: record.purpose,
      });
    }
  } catch (err) {
    logger.warn("[transcription] exceção ao salvar telemetria em llm_calls", {
      error: err instanceof Error ? err.message : String(err),
      organizationId: record.organization_id,
    });
  }
}

export function apiTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = creds.baseUrl ?? DEFAULT_BASE;
  const model = creds.model ?? DEFAULT_MODEL;
  const provider = derivarProviderTranscricao(creds);

  return {
    async transcribe(audio, mime) {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
        `audio.${extFor(mime)}`,
      );

      const startMs = Date.now();
      let telemetriaRegistrada = false;

      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}` },
          body: form,
          signal: creds.signal,
        });
      } catch (err) {
        const latencyMs = Date.now() - startMs;
        const msg = err instanceof Error ? err.message : String(err);

        if (!telemetriaRegistrada && creds.organizationId) {
          telemetriaRegistrada = true;
          await salvarTelemetriaTranscricao(
            {
              organization_id: creds.organizationId,
              purpose: PURPOSE_TRANSCRICAO,
              provider,
              model,
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              cost_cents: null,
              latency_ms: latencyMs,
              status: "erro",
              error_code: "transcription_network_error",
              error_message: msg,
              http_status: null,
            },
            { onRecordTelemetry: creds.onRecordTelemetry },
          );
        }
        throw err;
      }

      const latencyMs = Date.now() - startMs;

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const msg = `transcription_${res.status}: ${detail.slice(0, 200)}`;

        if (!telemetriaRegistrada && creds.organizationId) {
          telemetriaRegistrada = true;
          await salvarTelemetriaTranscricao(
            {
              organization_id: creds.organizationId,
              purpose: PURPOSE_TRANSCRICAO,
              provider,
              model,
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              cost_cents: null,
              latency_ms: latencyMs,
              status: "erro",
              error_code: `transcription_${res.status}`,
              error_message: msg,
              http_status: res.status,
            },
            { onRecordTelemetry: creds.onRecordTelemetry },
          );
        }
        throw new Error(msg);
      }

      // Sucesso na chamada de transcrição
      if (!telemetriaRegistrada && creds.organizationId) {
        telemetriaRegistrada = true;
        await salvarTelemetriaTranscricao(
          {
            organization_id: creds.organizationId,
            purpose: PURPOSE_TRANSCRICAO,
            provider,
            model,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost_cents: null,
            latency_ms: latencyMs,
            status: "ok",
            http_status: res.status,
          },
          { onRecordTelemetry: creds.onRecordTelemetry },
        );
      }

      const json = (await res.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}
