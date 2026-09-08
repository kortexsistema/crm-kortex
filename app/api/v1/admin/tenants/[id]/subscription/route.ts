import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";

const subscriptionUpdateSchema = z.object({
  plan: z.enum(["standard", "pro", "enterprise"]).optional(),
  subscription_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  days_to_add: z.number().int().min(1).max(3650).optional(),
  reactivate_if_suspended: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supportDenied = await requireSupportWrite((await params).id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: tenantId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: z.infer<typeof subscriptionUpdateSchema>;
  try {
    const raw = await req.json();
    body = subscriptionUpdateSchema.parse(raw);
  } catch {
    return fail("validation_failed", "Invalid request body", 400, { requestId });
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug, display_name, status, plan, subscription_expires_at, settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  let newExpiresAt: string | null = org.subscription_expires_at;

  if (body.days_to_add) {
    const baseDate =
      org.subscription_expires_at && new Date(org.subscription_expires_at).getTime() > Date.now()
        ? new Date(org.subscription_expires_at)
        : new Date();
    baseDate.setDate(baseDate.getDate() + body.days_to_add);
    newExpiresAt = baseDate.toISOString();
  } else if (body.subscription_expires_at !== undefined) {
    newExpiresAt = body.subscription_expires_at;
  }

  const newPlan = body.plan ?? (org as { plan?: string }).plan ?? "standard";
  const currentSettings = (org.settings as Record<string, unknown>) ?? {};
  const updatedSettings = {
    ...currentSettings,
    plan: newPlan,
  };

  const updatePayload: Record<string, unknown> = {
    plan: newPlan,
    subscription_expires_at: newExpiresAt,
    settings: updatedSettings,
    updated_at: new Date().toISOString(),
  };

  let reactivated = false;
  if (body.reactivate_if_suspended && org.status === "suspended") {
    updatePayload.status = "active";
    updatePayload.suspended_at = null;
    updatePayload.suspended_reason = null;
    updatePayload.suspended_by = null;
    reactivated = true;
  }

  const { error: updateError } = await admin
    .from("organizations")
    .update(updatePayload as never)
    .eq("id", tenantId);

  if (updateError) {
    return fail("internal_error", "Failed to update subscription", 500, { requestId });
  }

  void audit({
    action: "tenant.subscription_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: {
      tenant_id: tenantId,
      old_plan: (org as { plan?: string }).plan,
      new_plan: newPlan,
      old_expires_at: org.subscription_expires_at,
      new_expires_at: newExpiresAt,
      reactivated,
    },
  });

  return ok(
    {
      id: tenantId,
      plan: newPlan,
      subscription_expires_at: newExpiresAt,
      status: reactivated ? "active" : org.status,
    },
    { requestId },
  );
}
