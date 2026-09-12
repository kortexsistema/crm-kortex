"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveExternalSupabase(url: string, apiKey: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401);

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403);

  // Require admin/manager role for integrations
  const authZ = await requireRole("manager");
  if (!authZ.ok) return authZ.response;

  const admin = createAdminClient();
  const encrypted = await admin.rpc("fn_encrypt_oauth", { plaintext: apiKey });
  
  if (encrypted.error || !encrypted.data) {
    return fail("encrypt_failed", "Falha ao proteger a chave de API externa.", 500);
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
    return fail("db_error", "Erro ao salvar integração: " + upsertErr.message, 500);
  }

  await audit({
    action: "integrations.external_supabase.connected",
    organizationId: activeOrg.orgId,
    metadata: { supabase_url: url },
  });

  revalidatePath("/app/settings/integrations");
  return ok({ success: true });
}
