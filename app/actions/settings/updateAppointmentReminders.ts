"use server";

import { z } from "zod";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

const formSchema = z.object({
  enabled: z.boolean(),
  hours_before: z.number().min(1).max(72),
  custom_prompt: z.string().max(1000).optional(),
});

export async function updateAppointmentReminders(data: z.infer<typeof formSchema>) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) {
    return { ok: false, error: "forbidden_tenant" };
  }

  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false, error: "forbidden_role" };
  }

  const parsed = formSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed" };
  }

  const admin = createAdminClient();
  
  // Usamos JSONB_SET em uma query raw ou buscamos o settings atual e damos update
  const { data: org, error: fetchErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .single();
    
  if (fetchErr) {
    return { ok: false, error: "nao_gravou" };
  }
  
  const currentSettings = (org.settings as Record<string, unknown>) || {};
  const newSettings = {
    ...currentSettings,
    appointment_reminders: parsed.data
  };

  const { error: updateErr } = await admin
    .from("organizations")
    .update({ settings: newSettings })
    .eq("id", activeOrg.orgId);

  if (updateErr) {
    return { ok: false, error: "nao_gravou" };
  }

  return { ok: true };
}
