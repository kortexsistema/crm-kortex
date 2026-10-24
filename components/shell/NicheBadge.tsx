"use client";

import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_NICHE_MAP, type BusinessNiche } from "@/lib/niches/types";

/**
 * Indicador visual informativo do nicho de negócio ativo na organização.
 * Apenas para exibição — não possui controles de alteração na interface do cliente.
 */
export function NicheBadge() {
  const activeOrg = useActiveOrg();

  if (!activeOrg?.niche_id) return null;

  const nicheKey = (activeOrg.niche_id as BusinessNiche) in BUSINESS_NICHE_MAP
    ? (activeOrg.niche_id as BusinessNiche)
    : "ecommerce";

  const meta = BUSINESS_NICHE_MAP[nicheKey];
  const icon = nicheKey === "vehicles" ? "🚗" : "🛒";

  return (
    <div className="flex items-center" title={`Módulo Ativo: ${meta.label}`}>
      <Badge
        variant="neutral"
        className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium tracking-tight bg-muted/60 text-muted-foreground border-border/50 select-none"
        data-testid="tenant-niche-badge"
      >
        <span aria-hidden="true">{icon}</span>
        <span>{meta.label}</span>
      </Badge>
    </div>
  );
}
