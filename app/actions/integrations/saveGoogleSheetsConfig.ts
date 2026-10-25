"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/require-role";
import { normalizeGoogleSheetsUrl } from "@/lib/integrations/google-sheets/url";
import type { GoogleSheetsStoreMetadata } from "@/lib/integrations/google-sheets/types";

export async function saveGoogleSheetsConfig(params: {
  sheetUrl: string;
  sheetGid?: string;
  autoSync?: boolean;
}) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Autenticação necessária." } };
  if (supportWriteError(authUser.support)) {
    return { ok: false, error: { message: "Suporte não pode escrever." } };
  }

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  const norm = normalizeGoogleSheetsUrl(params.sheetUrl, params.sheetGid);
  if (!norm.ok) {
    return { ok: false, error: { message: norm.error } };
  }

  const admin = createAdminClient();

  // Preserva metadados anteriores de sincronização se existirem
  const { data: existing } = await admin
    .from("tenant_integrations")
    .select("store_metadata")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "google_sheets")
    .maybeSingle();

  const prevMeta = (existing?.store_metadata as GoogleSheetsStoreMetadata) || {};

  const metadata: GoogleSheetsStoreMetadata = {
    ...prevMeta,
    sheet_url: params.sheetUrl.trim(),
    sheet_gid: params.sheetGid?.trim() || undefined,
    auto_sync: params.autoSync ?? true,
  };

  const { error: upsertErr } = await admin.from("tenant_integrations").upsert(
    {
      organization_id: activeOrg.orgId,
      provider: "google_sheets",
      oauth_access_token_encrypted: "",
      webhook_secret_encrypted: "",
      store_metadata: metadata,
      status: "healthy",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );

  if (upsertErr) {
    return {
      ok: false,
      error: { message: `Erro ao salvar integração: ${upsertErr.message}` },
    };
  }

  await audit({
    action: "integrations.google_sheets.configured",
    organizationId: activeOrg.orgId,
    actorUserId: authUser.id,
    metadata: {
      sheet_url: params.sheetUrl,
      sheet_gid: params.sheetGid,
      auto_sync: metadata.auto_sync,
    },
  });

  revalidatePath("/app/settings/integrations");
  revalidatePath("/app/ai/knowledge/sources");
  return { ok: true, data: { success: true } };
}
