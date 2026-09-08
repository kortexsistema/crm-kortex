"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { invalidarCacheCredenciaisPlataforma } from "@/lib/ai/credenciais/plataforma";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

const entradaSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "openrouter"]),
});

export type DeletePlatformAiCredentialInput = z.infer<typeof entradaSchema>;

export type DeletePlatformAiCredentialResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Remove uma credencial de IA da plataforma.
 * Exclusivo para Platform Admins (`requirePlatformAdmin`).
 */
export async function deletePlatformAiCredential(
  input: DeletePlatformAiCredentialInput,
): Promise<DeletePlatformAiCredentialResult> {
  const { user: authUser } = await requirePlatformAdmin();

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input" };
  }

  const { provider } = parsed.data;
  const admin = createAdminClient();

  const { error } = await admin
    .from("platform_ai_credentials")
    .delete()
    .eq("provider", provider);

  if (error) {
    return { ok: false, error: error.message };
  }

  invalidarCacheCredenciaisPlataforma();

  const cabecalhos = await headers();
  await audit({
    action: "platform_ai_credential.deleted",
    actorUserId: authUser.id,
    resourceType: "platform_ai_credential",
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    metadata: { provider },
  });

  return { ok: true };
}
