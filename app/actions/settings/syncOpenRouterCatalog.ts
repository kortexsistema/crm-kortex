"use server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { sincronizarCatalogo } from "@/app/api/v1/cron/sync-model-catalog/route";
import type { ModeloDaOpenRouter } from "@/lib/ai/catalogo/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const ENDPOINT_DO_CATALOGO = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 25_000;

async function buscarDaOpenRouter(): Promise<ModeloDaOpenRouter[]> {
  const res = await fetch(ENDPOINT_DO_CATALOGO, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`catalogo_origem_status_${res.status}`);
  const json = (await res.json()) as { data?: ModeloDaOpenRouter[] };
  if (!Array.isArray(json.data)) {
    throw new Error("catalogo_origem_shape_inesperado — a resposta não trouxe `data` como lista");
  }
  return json.data;
}

export type SyncOpenRouterCatalogResult =
  | { ok: true; recebidos: number; gravados: number; depreciados: number; ressuscitados: number }
  | { ok: false; error: string };

/**
 * Dispara a sincronização sob demanda do catálogo público da OpenRouter.
 * Exclusivo para Platform Admins (`requirePlatformAdmin`).
 */
export async function syncOpenRouterCatalog(): Promise<SyncOpenRouterCatalogResult> {
  await requirePlatformAdmin();

  try {
    const admin = createAdminClient();
    const res = await sincronizarCatalogo(admin, buscarDaOpenRouter);
    logger.info("[sync-openrouter-action] catálogo sincronizado com sucesso", { ...res });
    return { ok: true, ...res };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido ao sincronizar catálogo";
    logger.error("[sync-openrouter-action] falha ao sincronizar catálogo", { error: msg });
    return { ok: false, error: msg };
  }
}
