import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { businessNicheSchema, BUSINESS_NICHE_MAP } from "@/lib/niches/types";

const nicheUpdateSchema = z.object({
  niche_id: businessNicheSchema,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: tenantId } = await params;

  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, niche_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  return ok(
    {
      organization_id: tenantId,
      niche_id: org.niche_id ?? "ecommerce",
      available_niches: Object.values(BUSINESS_NICHE_MAP),
    },
    { requestId },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tenantId } = await params;
  const supportDenied = await requireSupportWrite(tenantId);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: z.infer<typeof nicheUpdateSchema>;
  try {
    const raw = await req.json();
    body = nicheUpdateSchema.parse(raw);
  } catch {
    return fail("validation_failed", "Invalid request body", 400, { requestId });
  }

  const admin = createAdminClient();

  // Valida contra os registros homologados e ativos em business_niches
  const { data: nicheRow, error: nicheError } = await admin
    .from("business_niches")
    .select("id, active")
    .eq("id", body.niche_id)
    .maybeSingle();

  if (nicheError || !nicheRow || !nicheRow.active) {
    return fail("unprocessable_entity", "Nicho de negócio inativo ou não homologado", 422, { requestId });
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, niche_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  const oldNiche = org.niche_id ?? "ecommerce";
  const newNiche = body.niche_id;

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      niche_id: newNiche,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", tenantId);

  if (updateError) {
    return fail("internal_error", "Failed to update tenant niche", 500, { requestId });
  }

  void audit({
    action: "tenant.niche_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: {
      tenant_id: tenantId,
      old_niche: oldNiche,
      new_niche: newNiche,
    },
  });

  return ok(
    {
      id: tenantId,
      niche_id: newNiche,
    },
    { requestId },
  );
}
