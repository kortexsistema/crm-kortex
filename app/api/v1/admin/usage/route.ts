import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
  tenant_id: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageTenantRow {
  organization_id: string;
  tenant_name: string;
  tenant_slug: string;
  messages_count: number;
  ai_invocations_count: number;
  ai_tokens_total: number;
  ai_cost_cents: number;
  conversations_count: number;
}

export interface DailyPoint {
  date: string;
  count: number;
}

export interface DailyCostPoint {
  date: string;
  cents: number;
}

export interface DailyTokensPoint {
  date: string;
  tokens: number;
}

export interface UsageSeries {
  messages: DailyPoint[];
  ai_cost: DailyCostPoint[];
  ai_tokens: DailyTokensPoint[];
}

export interface UsageData {
  range: "7d" | "30d" | "90d";
  tenants: UsageTenantRow[];
  series: UsageSeries;
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/usage
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_error", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { range, tenant_id } = parsed.data;
  const rangeMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const days = rangeMap[range] ?? 30;

  const admin = createAdminClient();

  // -------------------------------------------------------------------------
  // Per-tenant aggregates
  // -------------------------------------------------------------------------

  // Fetch organizations first (need name/slug)
  let orgsQuery = admin
    .from("organizations")
    .select("id, display_name, slug");
  if (tenant_id) {
    orgsQuery = orgsQuery.eq("id", tenant_id);
  }
  const { data: orgs, error: orgsError } = await orgsQuery;
  if (orgsError) {
    return fail("db_error", "Failed to fetch organizations", 500, { requestId });
  }

  const orgMap = new Map(
    (orgs ?? []).map((o: { id: string; display_name: string; slug: string }) => [
      o.id,
      { display_name: o.display_name, slug: o.slug },
    ]),
  );

  const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);

  // Call the new RPCs to compute usage (bypasses max_rows limit)
  const [tenantStatsRes, dailyStatsRes] = await Promise.all([
    admin.rpc("fn_admin_usage_tenant_aggregates", { p_days: days, p_tenant_id: tenant_id ?? null }),
    admin.rpc("fn_admin_usage_daily_series", { p_days: days, p_tenant_id: tenant_id ?? null })
  ]);

  if (tenantStatsRes.error) {
    return fail("db_error", "Failed to compute tenant aggregates", 500, { requestId, details: tenantStatsRes.error });
  }

  if (dailyStatsRes.error) {
    return fail("db_error", "Failed to compute daily series", 500, { requestId, details: dailyStatsRes.error });
  }

  // Build tenant rows
  const tenants: UsageTenantRow[] = (tenantStatsRes.data ?? [])
    .map((row: any) => {
      const meta = orgMap.get(row.organization_id) ?? { display_name: row.organization_id, slug: "" };
      return {
        organization_id: row.organization_id,
        tenant_name: meta.display_name,
        tenant_slug: meta.slug,
        messages_count: Number(row.messages_count ?? 0),
        ai_invocations_count: Number(row.ai_invocations_count ?? 0),
        ai_tokens_total: Number(row.ai_tokens_total ?? 0),
        ai_cost_cents: Number(row.ai_cost_cents ?? 0),
        conversations_count: Number(row.conversations_count ?? 0),
      };
    })
    .sort(
      (a: UsageTenantRow, b: UsageTenantRow) =>
        b.ai_cost_cents - a.ai_cost_cents ||
        b.messages_count - a.messages_count,
    );

  // -------------------------------------------------------------------------
  // Daily series
  // -------------------------------------------------------------------------

  // The RPC returns a sorted array of all days in the requested window
  const series: UsageSeries = {
    messages: (dailyStatsRes.data ?? []).map((row: any) => ({
      date: row.date_label,
      count: Number(row.messages_count ?? 0),
    })),
    ai_cost: (dailyStatsRes.data ?? []).map((row: any) => ({
      date: row.date_label,
      cents: Number(row.ai_cost_cents ?? 0),
    })),
    ai_tokens: (dailyStatsRes.data ?? []).map((row: any) => ({
      date: row.date_label,
      tokens: Number(row.ai_tokens_total ?? 0),
    })),
  };

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  void audit({
    action: "platform_admin.usage_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    metadata: { range, tenant_id: tenant_id ?? null },
    requestId,
  });

  return ok<UsageData>({ range, tenants, series }, { requestId });
}
