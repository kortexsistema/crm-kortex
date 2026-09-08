import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export interface SubscriptionWatcherResult {
  scanned: number;
  suspended: number;
  organizations: string[];
}

export async function checkExpiredSubscriptions(
  admin: ReturnType<typeof createAdminClient>,
  now: Date,
  requestId: string,
): Promise<SubscriptionWatcherResult> {
  const nowIso = now.toISOString();

  const { data, error } = await admin
    .from("organizations")
    .select("id, slug, display_name, subscription_expires_at")
    .eq("status", "active")
    .not("subscription_expires_at", "is", null)
    .lt("subscription_expires_at", nowIso)
    .limit(500);

  if (error) throw new Error(`query_failed: ${error.message}`);

  const expiredOrgs = (data ?? []) as Array<{
    id: string;
    slug: string;
    display_name: string;
    subscription_expires_at: string;
  }>;

  if (expiredOrgs.length === 0) {
    return { scanned: 0, suspended: 0, organizations: [] };
  }

  const suspendedIds: string[] = [];

  for (const org of expiredOrgs) {
    const expiresFormatted = new Date(org.subscription_expires_at).toLocaleDateString("pt-BR");
    const { error: updErr } = await admin
      .from("organizations")
      .update({
        status: "suspended",
        suspended_at: nowIso,
        suspended_reason: `Assinatura expirada em ${expiresFormatted}. Aguardando renovação manual.`,
        updated_at: nowIso,
      } as never)
      .eq("id", org.id)
      .eq("status", "active");

    if (!updErr) {
      suspendedIds.push(org.id);
      logger.info("[subscription-watcher] tenant suspenso por expiração", {
        organizationId: org.id,
        slug: org.slug,
        requestId,
      });
    } else {
      logger.error("[subscription-watcher] falha ao suspender tenant", {
        organizationId: org.id,
        error: updErr.message,
        requestId,
      });
    }
  }

  return {
    scanned: expiredOrgs.length,
    suspended: suspendedIds.length,
    organizations: suspendedIds,
  };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let result: SubscriptionWatcherResult;
  try {
    result = await checkExpiredSubscriptions(createAdminClient(), new Date(), requestId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[subscription-watcher] falhou", { error: detail, requestId });
    return fail("internal_error", "Failed to process expired subscriptions.", 500, { requestId });
  }

  // Doutrina: só audita se houve efeito (linhas suspensas)
  if (result.suspended > 0) {
    void audit({
      action: "tenant.subscription_expired_batch",
      organizationId: null,
      bypassedRls: true,
      metadata: result as unknown as Record<string, unknown>,
      requestId,
    });
  }

  return ok(result, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
