"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { invalidarCacheCredenciaisPlataforma } from "@/lib/ai/credenciais/plataforma";
import { validateProviderKey } from "@/lib/ai/provider-validators";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { bufToBytea, encryptKey } from "@/lib/crypto/aes_gcm";
import { createAdminClient } from "@/lib/supabase/admin";

import { IDS_DE_PROVEDOR } from "@/lib/ai/pontos/provedores";

const entradaSchema = z.object({
  provider: z.enum(IDS_DE_PROVEDOR),
  apiKey: z.string().trim().min(5, "Chave de API deve ter pelo menos 5 caracteres"),
  isActive: z.boolean().default(true),
});

export type UpdatePlatformAiCredentialInput = z.infer<typeof entradaSchema>;

export type UpdatePlatformAiCredentialResult =
  | { ok: true; models: string[]; last4: string }
  | { ok: false; error: string; details?: unknown };

/**
 * Cadastra ou atualiza uma credencial de IA global da plataforma (Admin Master).
 * Exclusivo para Platform Admins (`requirePlatformAdmin`).
 */
export async function updatePlatformAiCredential(
  input: UpdatePlatformAiCredentialInput,
): Promise<UpdatePlatformAiCredentialResult> {
  const { user: authUser } = await requirePlatformAdmin();

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", details: parsed.error.flatten() };
  }

  const { provider, apiKey, isActive } = parsed.data;

  // 1. Validação ao vivo junto ao provedor
  const validation = await validateProviderKey(provider, apiKey);
  if (!validation.ok && validation.error === "auth_failed_401") {
    return {
      ok: false,
      error: "Chave recusada pelo provedor (401/403 Não Autorizado). Verifique se a chave está correta e ativa.",
    };
  }

  // 2. Cifragem AES-256-GCM
  let encrypted;
  try {
    encrypted = encryptKey(apiKey);
  } catch (err) {
    return {
      ok: false,
      error: "Falha na cifragem da chave. Verifique se AI_CRED_AES_KEY está configurada no ambiente.",
    };
  }

  const admin = createAdminClient();
  const models = validation.ok ? validation.models : [];
  const validationError = !validation.ok ? validation.error : null;
  const validatedAt = validation.ok ? new Date().toISOString() : null;

  const { error } = await admin
    .from("platform_ai_credentials")
    .upsert(
      {
        provider,
        api_key_encrypted: bufToBytea(encrypted.ciphertext),
        api_key_iv: bufToBytea(encrypted.iv),
        api_key_tag: bufToBytea(encrypted.tag),
        api_key_last4: encrypted.last4,
        models_available: models,
        validated_at: validatedAt,
        validation_error: validationError,
        is_active: isActive,
        updated_at: new Date().toISOString(),
        updated_by: authUser.id,
      },
      { onConflict: "provider" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  invalidarCacheCredenciaisPlataforma();

  const cabecalhos = await headers();
  await audit({
    action: "platform_ai_credential.updated",
    actorUserId: authUser.id,
    resourceType: "platform_ai_credential",
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    metadata: {
      provider,
      last4: encrypted.last4,
      models_count: models.length,
      validated: validation.ok,
    },
  });

  return { ok: true, models, last4: encrypted.last4 };
}
