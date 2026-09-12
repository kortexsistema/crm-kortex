"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePlanLimit } from "@/lib/billing/plan-limits";
import { requireRole } from "@/lib/auth/require-role";

export async function saveExternalSupabase(url: string, apiKey: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };
  if (supportWriteError(authUser.support)) return { ok: false, error: { message: "Suporte não pode escrever." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  // Validate plan limit for integrations
  const limitCheck = await validatePlanLimit(activeOrg.orgId, "integrations");
  if (!limitCheck.allowed) {
    return { ok: false, error: { message: `Plano atingiu o limite máximo de integrações (${limitCheck.limit}).` } };
  }

  const admin = createAdminClient();
  const encrypted = await admin.rpc("fn_encrypt_oauth", { plaintext: apiKey });
  
  if (encrypted.error || !encrypted.data) {
    return { ok: false, error: { message: "Falha ao proteger a chave de API externa." } };
  }

  const { error: upsertErr } = await admin
    .from("tenant_integrations")
    .upsert(
      {
        organization_id: activeOrg.orgId,
        provider: "external_supabase",
        oauth_access_token_encrypted: encrypted.data, // Re-using the oauth field for the api key
        store_metadata: { supabase_url: url },
        status: "healthy",
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" }
    );

  if (upsertErr) {
    return { ok: false, error: { message: "Erro ao salvar integração: " + upsertErr.message } };
  }

  await audit({
    action: "integrations.external_supabase.connected",
    organizationId: activeOrg.orgId,
    metadata: { supabase_url: url },
  });

  revalidatePath("/app/settings/integrations");
  return { ok: true, data: { success: true } };
}
