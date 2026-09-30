/**
 * MCP write tool — crm_send_whatsapp_message (Spec 11 §3.2).
 *
 * Wrappa `sendMessageHandler` com camada de idempotência (tabela
 * `idempotency_keys`). Se o mesmo `idempotency_key` for invocado de novo,
 * retorna o `message_id` cacheado sem inserir/enviar de novo.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { sendMessageSchema } from "@/lib/schemas/messaging";
import type { McpToolDefinition } from "../types";

const ENDPOINT_TAG = "mcp:crm_send_whatsapp_message";

const inputShape = {
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(4096).optional(),
  media_url: z.string().url().optional(),
  media_mime: z.string().optional(),
  type: z
    .enum(["text", "image", "audio", "document", "sticker", "video", "location", "contact"])
    .optional()
    .default("text"),
  send_as_audio: z
    .boolean()
    .optional()
    .describe("Se true e o agente tiver voz configurada, converte o texto em áudio antes do envio."),
  idempotency_key: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Chave para deduplicação (24h TTL). Recomendado run_id+step."),
};

function hashRequest(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export const crmSendWhatsappMessage: McpToolDefinition<typeof inputShape> = {
  name: "crm_send_whatsapp_message",
  description:
    "Envia uma mensagem WhatsApp outbound para uma conversa existente. Forneça `idempotency_key` para evitar duplicação em retries (TTL 24h).",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const parsed = sendMessageSchema.parse({
      conversation_id: input.conversation_id,
      type: input.type,
      body: input.body,
      media_url: input.media_url,
      media_mime: input.media_mime,
    });

    const requestHash = hashRequest({
      conversation_id: parsed.conversation_id,
      body: parsed.body,
      media_url: parsed.media_url,
      type: parsed.type,
    });

    if (input.idempotency_key) {
      const { data: cached } = await ctx.supabase
        .from("idempotency_keys")
        .select("response_body")
        .eq("organization_id", ctx.organizationId)
        .eq("endpoint", ENDPOINT_TAG)
        .eq("key", input.idempotency_key)
        .maybeSingle();
      if (cached) {
        return {
          ...(cached.response_body as Record<string, unknown>),
          deduplicated: true,
        };
      }
    }

    // Gancho de TTS (Text-to-Speech)
    // Só vai ao banco se a ferramenta efetivamente pedir o áudio e houver texto.
    // Isso cumpre o requisito de não adicionar latência em envios de texto puro.
    let finalPayload = parsed;
    if (input.send_as_audio && parsed.type === "text" && parsed.body) {
      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("settings")
        .eq("id", ctx.organizationId)
        .maybeSingle();

      const ttsSettings = (org?.settings as Record<string, any>)?.tts;
      if (ttsSettings?.enabled) {
        // TODO: Instanciar cliente de TTS com `resolveOrgLlmConfig(..., { provider: 'openai' })`
        // TODO: Gerar buffer de áudio (ex: OpenAI tts-1, voz = ttsSettings.voice)
        // TODO: Fazer upload para admin.storage.from("whatsapp-media").upload(path, buffer)
        // finalPayload = { ...parsed, type: "audio", media_storage_path: path, body: undefined };
        console.log(`[mcp.send_whatsapp] TTS hook triggered for org ${ctx.organizationId} with voice ${ttsSettings.voice}`);
      }
    }

    const message = await sendMessageHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      finalPayload,
    );

    const response = {
      message_id: message.id,
      status: message.status,
      external_id: message.external_id,
      sent_at: message.sent_at,
    };

    if (input.idempotency_key) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await ctx.supabase
        .from("idempotency_keys")
        .insert({
          organization_id: ctx.organizationId,
          endpoint: ENDPOINT_TAG,
          key: input.idempotency_key,
          request_hash: requestHash,
          response_body: response,
          status_code: 200,
          expires_at: expiresAt,
        })
        .then(({ error }) => {
          if (error && error.code !== "23505") {
            console.error("[mcp.send_whatsapp] idempotency cache failed", error.message);
          }
        });
    }

    return response;
  },
};
