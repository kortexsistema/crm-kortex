"use server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { logger } from "@/lib/logger";
import { syncOpenRouterCatalog } from "./syncOpenRouterCatalog";

export interface SyncGlobalResult {
  ok: boolean;
  message?: string;
  resumo: Record<
    string,
    { ok: true; gravados: number; depreciados: number; ressuscitados: number } | { ok: false; error: string }
  >;
}

/**
 * Percorre todos os provedores suportados e executa a sincronização
 * para aqueles que declaram `catalogoSincronizavel: true`.
 * Exclusivo para Platform Admins (`requirePlatformAdmin`).
 */
export async function syncAllCatalogs(): Promise<SyncGlobalResult> {
  await requirePlatformAdmin();

  const resumo: SyncGlobalResult["resumo"] = {};
  const provedoresSincronizaveis = PROVEDORES.filter((p) => p.catalogoSincronizavel);

  if (provedoresSincronizaveis.length === 0) {
    return { ok: true, resumo, message: "Nenhum provedor possui catálogo sincronizável." };
  }

  let teveFalha = false;

  for (const provider of provedoresSincronizaveis) {
    try {
      if (provider.id === "openrouter") {
        const res = await syncOpenRouterCatalog();
        if (res.ok) {
          resumo[provider.id] = {
            ok: true,
            gravados: res.gravados,
            depreciados: res.depreciados,
            ressuscitados: res.ressuscitados,
          };
        } else {
          teveFalha = true;
          resumo[provider.id] = { ok: false, error: res.error };
        }
      } else {
        // Ponto de extensão futuro para outros provedores
        resumo[provider.id] = { ok: false, error: "Sincronização não implementada para este provedor." };
        teveFalha = true;
      }
    } catch (err) {
      teveFalha = true;
      const msg = err instanceof Error ? err.message : "Erro inesperado ao sincronizar";
      logger.error(`[sync-all-catalogs] falha no provedor ${provider.id}`, { error: msg });
      resumo[provider.id] = { ok: false, error: msg };
    }
  }

  if (teveFalha) {
    logger.warn("[sync-all-catalogs] sincronização concluída com erros em alguns provedores", { resumo });
    return { ok: false, resumo, message: "Alguns provedores falharam durante a sincronização." };
  }

  logger.info("[sync-all-catalogs] todos os catálogos sincronizados com sucesso", { resumo });
  return { ok: true, resumo };
}
