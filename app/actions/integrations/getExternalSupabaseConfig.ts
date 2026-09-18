"use server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function getExternalSupabaseConfig() {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_integrations")
    .select("id, store_metadata")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "external_supabase")
    .single();

  if (error) {
    if (error.code === "PGRST116") return { ok: true, data: null }; // Not found
    return { ok: false, error: { message: error.message } };
  }

  return { 
    ok: true, 
    data: { 
      id: data.id,
      url: (data.store_metadata as Record<string, unknown>)?.supabase_url || "" 
    } 
  };
}
