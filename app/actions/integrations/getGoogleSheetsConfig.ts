"use server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { GoogleSheetsConfigResponse, GoogleSheetsStoreMetadata } from "@/lib/integrations/google-sheets/types";

// @effect-exempt: apenas leitura de configuração
export async function getGoogleSheetsConfig(): Promise<
  { ok: true; data: GoogleSheetsConfigResponse | null } | { ok: false; error: { message: string } }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Autenticação necessária." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_integrations")
    .select("id, store_metadata, status, last_sync_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "google_sheets")
    .maybeSingle();

  if (error) {
    return { ok: false, error: { message: error.message } };
  }

  if (!data) {
    return { ok: true, data: null };
  }

  const meta = (data.store_metadata as GoogleSheetsStoreMetadata) || {};

  return {
    ok: true,
    data: {
      id: data.id,
      sheet_url: meta.sheet_url || "",
      sheet_gid: meta.sheet_gid || "",
      auto_sync: meta.auto_sync ?? true,
      status: data.status || "healthy",
      last_sync_at: data.last_sync_at || null,
      last_sync_status: meta.last_sync_status || null,
      last_sync_error: meta.last_sync_error || null,
      last_sync_products_count: meta.last_sync_products_count || 0,
      last_sync_created_count: meta.last_sync_created_count || 0,
      last_sync_updated_count: meta.last_sync_updated_count || 0,
    },
  };
}
