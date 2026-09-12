"use server";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { supportWriteError } from "@/lib/impersonate/support";

export async function testExternalSupabase(url: string, apiKey: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401);
  if (supportWriteError(authUser.support)) return fail("forbidden_support", "Suporte não pode testar/escrever.", 403);
  
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403);

  const authZ = await requireRole("manager");
  if (!authZ.ok) return authZ.response;

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (res.ok) {
      return ok({ success: true, message: "Conexão bem-sucedida!" });
    } else {
      return fail("connection_failed", `Erro na conexão: Status ${res.status}`, 400);
    }
  } catch (error: any) {
    return fail("connection_failed", `Falha de rede ao tentar conectar: ${error.message}`, 500);
  }
}
