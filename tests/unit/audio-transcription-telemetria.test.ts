/**
 * Testes unitários para a Etapa 3: Instrumentação de Telemetria de Transcrição de Áudio (Whisper) em `llm_calls`.
 *
 * Cobertura obrigatória:
 * 1. Transcrição bem-sucedida registra telemetria em llm_calls com status 'ok'
 * 2. Identificação correta de provider ('openai') e modelo ('whisper-1')
 * 3. Associação correta ao tenant (organizationId)
 * 4. Registro sem inventar tokens (input_tokens: 0, output_tokens: 0, cost_cents: null)
 * 5. Tratamento de chamada sem organizationId (não dá crash e pula insert inválido)
 * 6. Falha na API de transcrição registra status 'erro' e preserva o erro original
 * 7. Falha de rede registra status 'erro' e re-lança erro original
 * 8. Falha na gravação da telemetria NÃO interrompe a transcrição (resiliência total)
 * 9. Ausência de registros duplicados (no máximo 1 registro por invocação)
 * 10. Preservação do comportamento original e retorno do texto transcrito
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiTranscriptionProvider,
  derivarProviderTranscricao,
  type LlmCallTelemetryRecord,
} from "@/lib/messaging/media/transcription";

const ORG_ID = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Etapa 3 — Instrumentação de Telemetria de Transcrição de Áudio (Whisper)", () => {
  it("transcrição bem-sucedida registra telemetria em llm_calls com status 'ok'", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Olá, gostaria de saber mais sobre o produto." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-teste-whisper",
        organizationId: ORG_ID,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    const texto = await provider.transcribe(Buffer.from("audio fake"), "audio/ogg");

    expect(texto).toBe("Olá, gostaria de saber mais sobre o produto.");
    expect(telemetria).toHaveLength(1);

    const reg = telemetria[0];
    expect(reg?.organization_id).toBe(ORG_ID);
    expect(reg?.purpose).toBe("transcricao_de_audio");
    expect(reg?.provider).toBe("openai");
    expect(reg?.model).toBe("whisper-1");
    expect(reg?.input_tokens).toBe(0);
    expect(reg?.output_tokens).toBe(0);
    expect(reg?.cost_cents).toBeNull();
    expect(reg?.status).toBe("ok");
    expect(reg?.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("identifica corretamente provider 'openai' e modelo customizado quando configurado", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Texto transcrito com modelo customizado." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-teste-whisper",
        model: "whisper-large-v3",
        organizationId: ORG_ID,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    await provider.transcribe(Buffer.from("audio fake"), "audio/mp3");

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.provider).toBe("openai");
    expect(reg?.model).toBe("whisper-large-v3");
  });

  it("não inventa tokens nem custo arbitrário quando a API não retorna usage", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Sem tokens na resposta da API" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-teste-whisper",
        organizationId: ORG_ID,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    await provider.transcribe(Buffer.from("audio ogg"), "audio/ogg");

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.input_tokens).toBe(0);
    expect(reg?.output_tokens).toBe(0);
    expect(reg?.cache_read_tokens).toBe(0);
    expect(reg?.cache_write_tokens).toBe(0);
    expect(reg?.cost_cents).toBeNull();
  });

  it("falha na API registra status 'erro', código http e re-lança o erro original", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Invalid API key provided", {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-invalida",
        organizationId: ORG_ID,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    await expect(provider.transcribe(Buffer.from("audio fake"), "audio/wav")).rejects.toThrow(
      /transcription_401/,
    );

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.status).toBe("erro");
    expect(reg?.http_status).toBe(401);
    expect(reg?.error_code).toBe("transcription_401");
    expect(reg?.cost_cents).toBeNull();
  });

  it("falha de transporte/rede registra status 'erro' e re-lança o erro", async () => {
    const telemetria: LlmCallTelemetryRecord[] = [];

    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-whisper",
        organizationId: ORG_ID,
        onRecordTelemetry: (rec) => {
          telemetria.push(rec);
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    await expect(provider.transcribe(Buffer.from("audio fake"), "audio/ogg")).rejects.toThrow(
      "Connection reset by peer",
    );

    expect(telemetria).toHaveLength(1);
    const reg = telemetria[0];
    expect(reg?.status).toBe("erro");
    expect(reg?.error_code).toBe("transcription_network_error");
    expect(reg?.error_message).toContain("Connection reset by peer");
  });

  it("falha na gravação de telemetria NÃO impede a transcrição nem altera o texto retornado", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Texto entregue com sucesso apesar da falha na telemetria" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-teste-whisper",
        organizationId: ORG_ID,
        onRecordTelemetry: () => {
          throw new Error("Erro simulado no banco de telemetria");
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    const texto = await provider.transcribe(Buffer.from("audio ogg"), "audio/ogg");
    expect(texto).toBe("Texto entregue com sucesso apesar da falha na telemetria");
  });

  it("evita registros duplicados: gera no máximo 1 registro por invocação", async () => {
    let contagem = 0;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Mensagem curta" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-whisper",
        organizationId: ORG_ID,
        onRecordTelemetry: () => {
          contagem++;
        },
      },
      mockFetch as unknown as typeof fetch,
    );

    await provider.transcribe(Buffer.from("audio"), "audio/mp3");
    expect(contagem).toBe(1);
  });

  it("chamada sem organizationId não causa crash e preserva a transcrição", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Transcrição sem organizationId" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = apiTranscriptionProvider(
      {
        apiKey: "sk-whisper",
        // Sem organizationId
      },
      mockFetch as unknown as typeof fetch,
    );

    const texto = await provider.transcribe(Buffer.from("audio"), "audio/ogg");
    expect(texto).toBe("Transcrição sem organizationId");
  });

  it("derivarProviderTranscricao resolve 'openai' para Whisper", () => {
    expect(derivarProviderTranscricao({ apiKey: "x", model: "whisper-1" })).toBe("openai");
    expect(derivarProviderTranscricao({ apiKey: "x", baseUrl: "https://api.openai.com" })).toBe("openai");
  });
});

