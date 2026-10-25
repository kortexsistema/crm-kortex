"use server";

import { revalidatePath } from "next/cache";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { syncGoogleSheetsStock } from "@/lib/integrations/google-sheets/sync";
import type { GoogleSheetsSyncResult } from "@/lib/integrations/google-sheets/types";

export async function syncGoogleSheetsNow(): Promise<
  { ok: true; data: GoogleSheetsSyncResult } | { ok: false; error: { message: string } }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Autenticação necessária." } };
  if (supportWriteError(authUser.support)) {
    return { ok: false, error: { message: "Suporte não pode escrever." } };
  }

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  const result = await syncGoogleSheetsStock({
    organizationId: activeOrg.orgId,
    triggeredBy: `user:${authUser.id}`,
  });

  if (!result.ok) {
    return { ok: false, error: { message: result.error } };
  }

  revalidatePath("/app/settings/integrations");
  revalidatePath("/app/ai/knowledge/sources");
  revalidatePath("/app/catalog");
  return { ok: true, data: result.data };
}
