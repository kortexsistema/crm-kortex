"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { businessNicheSchema, type BusinessNiche } from "@/lib/niches/types";

const inputSchema = z.object({
  niche_id: businessNicheSchema,
});

export type UpdateTenantNicheResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateTenantNiche(rawInput: { niche_id: BusinessNiche }): Promise<UpdateTenantNicheResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed" };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = createAdminClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Validação fail-closed contra registros ativos de business_niches
  const { data: nicheRow, error: nicheErr } = await supabase
    .from("business_niches")
    .select("id, active")
    .eq("id", parsed.data.niche_id)
    .maybeSingle();

  if (nicheErr || !nicheRow || !nicheRow.active) {
    return { ok: false, error: "niche_inactive_or_invalid" };
  }

  const { error: updateErr } = await supabase
    .from("organizations")
    .update({
      niche_id: parsed.data.niche_id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", activeOrg.orgId);

  if (updateErr) {
    return { ok: false, error: "db_error" };
  }

  void audit({
    action: "tenant.niche_updated",
    actorUserId: authUser.id,
    actingAsPlatformAdmin: authUser.is_platform_admin,
    bypassedRls: true,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    ip,
    userAgent,
    requestId,
    metadata: {
      from: activeOrg.niche_id,
      to: parsed.data.niche_id,
      source: "app_settings",
    },
  });

  revalidatePath("/app", "layout");
  revalidatePath("/app/settings/tenant");
  return { ok: true };
}
