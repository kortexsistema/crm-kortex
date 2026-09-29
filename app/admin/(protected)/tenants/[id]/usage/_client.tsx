"use client";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiUsage, type AiUsageFilters } from "@/hooks/ai/useAiUsage";
import { UsageFilters, type UsageFiltersAgent } from "@/components/ai/UsageFilters";
import { UsageChart } from "@/components/ai/UsageChart";
import { formatCentsUSD } from "@/lib/money";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  agents: UsageFiltersAgent[];
  initial: {
    agent_id?: string;
    invocation_kind?: string;
    from?: string;
    to?: string;
  };
  tenantId?: string;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function StatSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-8 w-32" />
        </Card>
      ))}
    </div>
  );
}

function ChartSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-[200px] w-full" />
        </div>
      ))}
    </div>
  );
}

export function UsageDashboardClient({ agents, initial, tenantId }: Props) {
  const t = useT();
  const searchParams = useSearchParams();

  const filters: AiUsageFilters = {
    agent_id: searchParams.get("agent_id") ?? undefined,
    invocation_kind: searchParams.get("invocation_kind") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  };

  const q = useAiUsage(filters, tenantId);

  return (
    <div className="flex flex-col gap-6 mt-6">
      <UsageFilters agents={agents} initial={initial} />

      {q.isLoading || !q.data ? (
        <>
          <StatSkeletons />
          <ChartSkeletons />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t("Custo no período")}
              value={formatCentsUSD(q.data.totals.cost_cents)}
            />
            <StatCard
              label={t("Atendimentos com IA")}
              value={q.data.totals.invocations.toLocaleString("pt-BR")}
            />
            <StatCard
              label={t("Passaram para uma pessoa")}
              value={`${(q.data.totals.handoff_rate * 100).toFixed(2)}%`}
              hint={t("quanto mais alto, mais a IA precisou de ajuda")}
            />
            <StatCard
              label={t("Tempo de resposta")}
              value={`${(q.data.totals.p95_latency_ms / 1000).toLocaleString("pt-BR", {
                maximumFractionDigits: 1,
              })} s`}
              hint={`${t("a maioria responde em")} ${(
                q.data.totals.p50_latency_ms / 1000
              ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s; ${t("este é o pior caso comum")}`}
            />
          </div>

          <UsageChart payload={q.data} />
        </>
      )}
    </div>
  );
}
