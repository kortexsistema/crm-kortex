"use server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { supportWriteError } from "@/lib/impersonate/support";

export async function testExternalSupabase(url: string, apiKey: string) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Auth required." } };
  if (supportWriteError(authUser.support)) return { ok: false, error: { message: "Suporte não pode testar/escrever." } };
  
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  const authZ = await requireRole("manager");
  if (!authZ.ok) return { ok: false, error: { message: "Permissão insuficiente." } };

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (res.ok) {
      return { ok: true, data: { success: true, message: "Conexão bem-sucedida!" } };
    } else {
      return { ok: false, error: { message: `Erro na conexão: Status ${res.status}` } };
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return { ok: false, error: { message: `Falha de rede ao tentar conectar: ${msg}` } };
  }
}
