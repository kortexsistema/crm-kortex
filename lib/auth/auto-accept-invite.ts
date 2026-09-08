import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AutoAcceptResult {
  ok: boolean;
  error?: string;
  organizationId?: string;
}

/**
 * Processa autoritativamente o aceite de um convite de equipe via token HMAC assinado.
 * Valida expiração, email do usuário, grava a membership via fn_accept_team_invite,
 * emite auditoria e define o cookie active_org.
 */
export async function processarAceiteDeConvite(
  token: string,
  user: { id: string; email?: string | null },
  requestId?: string | null,
): Promise<AutoAcceptResult> {
  const payload = verifyInviteToken(token);
  if (!payload) {
    return { ok: false, error: "invalid_or_expired" };
  }

  const userEmail = (user.email ?? "").trim().toLowerCase();
  const inviteEmail = payload.email.trim().toLowerCase();
  if (userEmail !== inviteEmail) {
    return { ok: false, error: "email_mismatch" };
  }

  const admin = createAdminClient();
  const { data: result, error } = await admin.rpc("fn_accept_team_invite", {
    p_interface_settings: payload.interface_settings ?? { preset: "completa" },
    p_user: user.id,
    p_org: payload.organization_id,
    p_role: payload.role,
    p_invited_by: payload.invited_by ?? null,
    p_issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    p_invited_at: new Date((payload.iat ?? payload.exp - 86400) * 1000).toISOString(),
  });

  if (error) {
    return { ok: false, error: error.code === "42501" ? "invalid_or_expired" : "internal_error" };
  }

  if (result?.changed) {
    await audit({
      action: "member.accepted",
      actorUserId: user.id,
      organizationId: payload.organization_id,
      resourceType: "membership",
      resourceId: result.id,
      requestId: requestId ?? undefined,
      metadata: { invite_id: payload.invite_id, role: payload.role },
    });
  }

  try {
    const store = await cookies();
    store.set("active_org", payload.organization_id, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // Caller em route handler pode gravar o Set-Cookie na Response diretamente se necessário.
  }

  return { ok: true, organizationId: payload.organization_id };
}

/**
 * Tenta resgatar e aceitar automaticamente um convite gravado em user_metadata.invite_token.
 * Busca o usuário atualizado no GoTrue via service role, valida o token e limpa o metadata após sucesso.
 * Retorna null se não houver convite pendente.
 */
export async function tentarAutoAceitarConvitePendente(
  user: { id: string; email?: string | null },
  requestId?: string | null,
): Promise<AutoAcceptResult | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data.user) return null;

  const token = data.user.user_metadata?.["invite_token"];
  if (typeof token !== "string" || token.trim() === "") return null;

  const res = await processarAceiteDeConvite(
    token,
    { id: user.id, email: data.user.email ?? user.email },
    requestId,
  );

  if (res.ok) {
    // Limpa o invite_token do user_metadata para não reprocessar no futuro
    try {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...data.user.user_metadata, invite_token: null },
      });
    } catch {
      // Falha silenciosa ao limpar metadados
    }
  }

  return res;
}
