"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().max(100),
  phone: z.string().max(20),
});

const schema = z.object({
  handoff_alert_contacts: z.array(contactSchema).optional(),
});

export type UpdateHandoffAlertContactsResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updateHandoffAlertContacts(input: z.infer<typeof schema>): Promise<UpdateHandoffAlertContactsResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
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

  const { data: orgRow, error: readErr } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const currentSettings = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  
  if (parsed.data.handoff_alert_contacts) {
    currentSettings.handoff_alert_contacts = parsed.data.handoff_alert_contacts;
  } else {
    delete currentSettings.handoff_alert_contacts;
  }

  const { error } = await supabase
    .from("organizations")
    .update({ settings: currentSettings })
    .eq("id", activeOrg.orgId);
    
  if (error) return { ok: false, error: error.message };

  await audit({
    action: "org.updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    requestId,
    ip,
    userAgent,
    metadata: {
      fields_changed: ["settings.handoff_alert_contacts"],
    },
  });

  revalidatePath("/app/settings/notifications");
  return { ok: true };
}
