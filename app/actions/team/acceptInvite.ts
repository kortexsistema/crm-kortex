"use server";
/**
 * Server Action: accept a team invite token.
 *
 * Steps:
 *   1. Verify HMAC token (signature + expiry).
 *   2. Get current authenticated user from cookie session.
 *   3. Email mismatch → return error (UI tells user to sign out / use the right account).
 *   4. INSERT user_organizations (organization_id, user_id, role, accepted_at, invited_by assinado).
 *      Replay preserva vínculo ativo; revogado exige convite posterior à revogação.
 *   5. Audit `member.accepted` and redirect to /app/inbox.
 */
import { readSupportContext } from "@/lib/impersonate/support";
import { redirect } from "next/navigation";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { processarAceiteDeConvite } from "@/lib/auth/auto-accept-invite";
import { createClient } from "@/lib/supabase/server";

export type AcceptInviteResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_or_expired" | "email_mismatch" | "not_authenticated" | "internal_error";
      message?: string;
      expectedEmail?: string;
    };

export async function acceptInviteAction(token: string): Promise<AcceptInviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  if (await readSupportContext(supabase))
    return {
      ok: false,
      error: "internal_error",
      message: "Saia do acompanhamento antes de aceitar o convite.",
    };

  const res = await processarAceiteDeConvite(token, user);
  if (!res.ok) {
    if (res.error === "email_mismatch") {
      const payload = verifyInviteToken(token);
      return { ok: false, error: "email_mismatch", expectedEmail: payload?.email };
    }
    return {
      ok: false,
      error: res.error === "invalid_or_expired" ? "invalid_or_expired" : "internal_error",
    };
  }

  redirect("/app");
}
