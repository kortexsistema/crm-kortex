import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { aggregateUsage, type InvocationRow } from "./aggregate";

export async function fetchAggregatedUsage(
  supabase: SupabaseClient<Database>,
  orgId: string,
  range: { from: Date; to: Date },
  filters?: { agent_id?: string; invocation_kind?: string }
) {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  let invRowsRaw: Record<string, unknown>[] = [];
  let page = 0;
  const pageSize = 1000;
  const maxRows = 50_000;
  let hasMore = true;

  while (hasMore && invRowsRaw.length < maxRows) {
    let invQ = supabase
      .from("llm_calls")
      .select("created_at, purpose, cost_cents, input_tokens, output_tokens, latency_ms, agent_id")
      .eq("organization_id", orgId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (filters?.agent_id) invQ = invQ.eq("agent_id", filters.agent_id);
    if (filters?.invocation_kind) invQ = invQ.eq("purpose", filters.invocation_kind);

    const { data: pageData, error: invErr } = await invQ;

    if (invErr) {
      console.warn("[ai-usage] llm_calls query failed", { error: invErr.message });
      throw new Error("Erro ao consultar llm_calls");
    }

    if (pageData && pageData.length > 0) {
      invRowsRaw = invRowsRaw.concat(pageData);
      if (pageData.length < pageSize) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
    page++;
  }

  const invRows = ((invRowsRaw ?? []) as unknown as Array<{
    created_at: string; purpose: string | null; cost_cents: number | null;
    input_tokens: number | null; output_tokens: number | null; latency_ms: number | null;
  }>).map((r) => ({
    created_at: r.created_at,
    invocation_kind: r.purpose ?? "turno",
    cost_cents: r.cost_cents,
    prompt_tokens: r.input_tokens,
    completion_tokens: r.output_tokens,
    total_tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    latency_ms: r.latency_ms,
  }));

  const dailyInbounds = new Map<string, number>();
  const { data: inboundRows, error: inboundErr } = await supabase
    .from("messages")
    .select("created_at")
    .eq("organization_id", orgId)
    .eq("direction", "inbound")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .limit(100_000);

  if (inboundErr) {
    console.warn("[ai-usage] inbound messages query failed", { error: inboundErr.message });
  } else {
    for (const r of inboundRows ?? []) {
      const day = (r as { created_at: string }).created_at.slice(0, 10);
      dailyInbounds.set(day, (dailyInbounds.get(day) ?? 0) + 1);
    }
  }

  const dailyHandoffs = new Map<string, number>();
  const { data: handoffRows, error: handoffErr } = await supabase
    .from("event_log")
    .select("created_at")
    .eq("organization_id", orgId)
    .eq("event_type", "ai.handoff_triggered")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .limit(100_000);

  if (handoffErr) {
    console.warn("[ai-usage] handoff events query failed", { error: handoffErr.message });
  } else {
    for (const r of handoffRows ?? []) {
      const day = (r as { created_at: string }).created_at.slice(0, 10);
      dailyHandoffs.set(day, (dailyHandoffs.get(day) ?? 0) + 1);
    }
  }

  return aggregateUsage(
    invRows as InvocationRow[],
    dailyInbounds,
    dailyHandoffs,
    range
  );
}
