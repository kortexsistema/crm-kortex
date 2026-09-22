import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/require-role";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { Resend } from "resend";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const resend = new Resend(env.RESEND_API_KEY);
  
  let userCtx = await requireRole("admin");
  if (!userCtx.ok) {
    return userCtx.response;
  }

  const { user, org: activeOrg } = userCtx;
  const organization_id = activeOrg.orgId;

  const admin = createAdminClient();
  const { data: orgData } = await admin
    .from("organizations")
    .select("slug, display_name")
    .eq("id", organization_id)
    .single();

  if (!orgData) {
    return fail("not_found", "Organization not found", 404, { requestId });
  }

  try {
    await resend.emails.send({
      from: "Kortex Platform Support <support@seusdominio.com>",
      to: "support@seusdominio.com", // Send to platform support
      subject: `[SaaS Upgrade Request] ${orgData.display_name}`,
      html: `
        <p>The organization <strong>${orgData.display_name}</strong> (slug: ${orgData.slug}) has requested more AI credits or a plan upgrade.</p>
        <p>Requested by: ${user.email} (User ID: ${user.id})</p>
      `,
    });
  } catch (error) {
    logger.error("Failed to send credit request email", { error, organization_id });
    // We still return OK to the client to not expose email provider errors
  }

  void audit({
    action: "tenant.requested_credits",
    actorUserId: user.id,
    actingAsPlatformAdmin: false,
    bypassedRls: false,
    organizationId: organization_id,
    resourceType: "organization",
    resourceId: organization_id,
    requestId,
  });

  return ok({ success: true }, { requestId });
}
