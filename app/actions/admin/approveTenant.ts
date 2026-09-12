"use server";

import { revalidatePath } from "next/cache";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export async function approveTenant(tenantId: string) {
  const user = await loadAuthUser();
  if (!user || !user.is_platform_admin) {
    return { ok: false, error: "Master Admin required." };
  }

  const admin = createAdminClient();

  const { data: org, error: fetchError } = await admin
    .from("organizations")
    .select("status")
    .eq("id", tenantId)
    .single();

  if (fetchError || !org) {
    return { ok: false, error: "Tenant não encontrado." };
  }

  if (org.status !== "pending") {
    return { ok: false, error: "Tenant não está pendente." };
  }

  const { error: updateError } = await admin
    .from("organizations")
    .update({ status: "active" })
    .eq("id", tenantId);

  if (updateError) {
    return { ok: false, error: "Falha ao aprovar tenant." };
  }

  await audit({
    action: "tenant.approved",
    actorUserId: user.id,
    organizationId: tenantId,
    metadata: { previous_status: "pending" },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");

  return { ok: true, approved: true };
}
