"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export async function getSupabaseTables(integrationId: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supabase_integration_tables")
    .select("*")
    .eq("organization_id", activeOrg.orgId)
    .eq("integration_id", integrationId);

  if (error) {
    return { ok: false, error: { message: error.message } };
  }

  return { ok: true, data };
}

export async function addSupabaseTable(
  integrationId: string,
  tableName: string,
  filterColumn: string,
  returnColumns: string[],
  instruction: string
) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };
  if (supportWriteError(authUser.support)) return { ok: false, error: { message: "Suporte não pode escrever." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  const supabase = await createClient();
  const { error } = await supabase.from("supabase_integration_tables").insert({
    organization_id: activeOrg.orgId,
    integration_id: integrationId,
    table_name: tableName,
    filter_column: filterColumn,
    return_columns: returnColumns,
    instruction: instruction,
  });

  if (error) {
    return { ok: false, error: { message: "Erro ao adicionar tabela: " + error.message } };
  }

  await audit({
    action: "integrations.external_supabase.connected",
    organizationId: activeOrg.orgId,
    metadata: { integrationId, tableName },
  });

  revalidatePath("/app/settings/integrations");
  return { ok: true, data: { success: true } };
}

export async function deleteSupabaseTable(id: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };
  if (supportWriteError(authUser.support)) return { ok: false, error: { message: "Suporte não pode escrever." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("supabase_integration_tables")
    .delete()
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId);

  if (error) {
    return { ok: false, error: { message: "Erro ao remover tabela: " + error.message } };
  }

  await audit({
    action: "integrations.external_supabase.connected",
    organizationId: activeOrg.orgId,
    metadata: { tableId: id },
  });

  revalidatePath("/app/settings/integrations");
  return { ok: true, data: { success: true } };
}
