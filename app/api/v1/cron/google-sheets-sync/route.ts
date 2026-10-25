/**
 * GET/POST /api/v1/cron/google-sheets-sync
 *
 * Rotina diária de sincronização automática do estoque e catálogo de produtos
 * via Google Sheets para todas as organizações ativas com auto_sync habilitado.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET | INTERNAL_SECRET.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGoogleSheetsStock } from "@/lib/integrations/google-sheets/sync";
import type { GoogleSheetsStoreMetadata } from "@/lib/integrations/google-sheets/types";

export const dynamic = "force-dynamic";

const SCAN_LIMIT = 100;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // Busca integrações do Google Sheets ativas que desejam sincronização automática
  const { data: integrations, error: listErr } = await admin
    .from("tenant_integrations")
    .select("id, organization_id, store_metadata, status")
    .eq("provider", "google_sheets")
    .neq("status", "disconnected")
    .limit(SCAN_LIMIT);

  if (listErr) {
    logger.error("[google-sheets-sync-cron] falha ao listar integrações", {
      error: listErr.message,
    });
    return fail("internal_error", "Falha ao buscar integrações.", 500, { requestId });
  }

  const elegiveis = (integrations || []).filter((item) => {
    const meta = (item.store_metadata as GoogleSheetsStoreMetadata) || {};
    // auto_sync ativo por padrão se não for explicitamente falso
    return meta.auto_sync !== false && Boolean(meta.sheet_url);
  });

  logger.info("[google-sheets-sync-cron] iniciando varredura de sincronização", {
    total_encontradas: integrations?.length || 0,
    total_elegiveis: elegiveis.length,
  });

  const resultados: Array<{
    organization_id: string;
    success: boolean;
    total?: number;
    criados?: number;
    atualizados?: number;
    skipped?: boolean;
    error?: string;
  }> = [];

  for (const item of elegiveis) {
    try {
      const res = await syncGoogleSheetsStock({
        organizationId: item.organization_id,
        triggeredBy: "cron:google-sheets-sync",
      });

      if (res.ok) {
        resultados.push({
          organization_id: item.organization_id,
          success: true,
          total: res.data.total,
          criados: res.data.criados,
          atualizados: res.data.atualizados,
        });
      } else {
        const isLocked = res.error.includes("já está em andamento");
        if (isLocked) {
          logger.info("[google-sheets-sync-cron] sincronização já em andamento, pulando", {
            organization_id: item.organization_id,
          });
        }
        resultados.push({
          organization_id: item.organization_id,
          success: false,
          skipped: isLocked,
          error: res.error,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[google-sheets-sync-cron] erro inesperado na organização", {
        organization_id: item.organization_id,
        error: msg,
      });
      resultados.push({
        organization_id: item.organization_id,
        success: false,
        error: msg,
      });
    }
  }

  return ok(
    {
      processados: elegiveis.length,
      sucesso_count: resultados.filter((r) => r.success).length,
      pulados_count: resultados.filter((r) => (r as { skipped?: boolean }).skipped).length,
      falha_count: resultados.filter((r) => !r.success && !(r as { skipped?: boolean }).skipped).length,
      detalhes: resultados,
    },
    { requestId },
  );
}

export { handle as GET, handle as POST };
