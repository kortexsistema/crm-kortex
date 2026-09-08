"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface TenantSubscriptionCardProps {
  organizationId: string;
  plan?: string | null;
  subscriptionExpiresAt?: string | null;
  status: string;
}

export function TenantSubscriptionCard({
  organizationId,
  plan = "standard",
  subscriptionExpiresAt,
  status,
}: TenantSubscriptionCardProps) {
  const t = useT();
  const queryClient = useQueryClient();

  const [selectedPlan, setSelectedPlan] = useState<string>(plan ?? "standard");
  const [customDate, setCustomDate] = useState<string>(
    subscriptionExpiresAt ? subscriptionExpiresAt.split("T")[0] ?? "" : "",
  );
  const [loading, setLoading] = useState(false);

  const expiresDate = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  const now = Date.now();
  let statusBadgeVariant: "success" | "warning" | "error" | "neutral" = "success";
  let statusBadgeLabel = t("Ativa");
  let diasRestantes: number | null = null;

  if (status === "suspended") {
    statusBadgeVariant = "error";
    statusBadgeLabel = t("Suspenso");
  } else if (expiresDate) {
    const diffMs = expiresDate.getTime() - now;
    diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diasRestantes <= 0) {
      statusBadgeVariant = "error";
      statusBadgeLabel = t("Expirado");
    } else if (diasRestantes <= 5) {
      statusBadgeVariant = "warning";
      statusBadgeLabel = t("Vence em breve");
    }
  }

  async function updateSubscription(payload: {
    plan?: string;
    days_to_add?: number;
    subscription_expires_at?: string | null;
    reactivate_if_suspended?: boolean;
  }) {
    setLoading(true);
    try {
      await apiClient.patch(`/api/v1/admin/tenants/${organizationId}/subscription`, {
        ...payload,
        reactivate_if_suspended: true,
      });
      toast.success(t("Assinatura atualizada com sucesso!"));
      await queryClient.invalidateQueries({
        queryKey: ["admin", "tenant", organizationId],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("Falha ao atualizar assinatura.");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-lg border bg-card p-5 space-y-4">
      <CardHeader className="p-0 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {t("Gestão de Assinatura (SaaS)")}
        </CardTitle>
        <Badge variant={statusBadgeVariant}>{statusBadgeLabel}</Badge>
      </CardHeader>

      <CardContent className="p-0 space-y-4 pt-1">
        {/* Info Vigente */}
        <div className="rounded-md border bg-muted/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t("Plano atual:")}</span>
            <strong className="text-sm uppercase text-foreground">{plan ?? "standard"}</strong>
          </div>
          <div className="flex items-center justify-between text-xs border-t pt-1.5">
            <span className="text-muted-foreground">{t("Validade:")}</span>
            <span className="font-medium text-foreground">
              {expiresDate
                ? expiresDate.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })
                : t("Vitalício / Indeterminado")}
            </span>
          </div>
          {diasRestantes !== null && (
            <div className="flex items-center justify-between text-xs border-t pt-1.5">
              <span className="text-muted-foreground">{t("Prazo restante:")}</span>
              <span
                className={
                  diasRestantes <= 5
                    ? "font-semibold text-amber-600 dark:text-amber-400"
                    : "font-medium text-foreground"
                }
              >
                {diasRestantes <= 0
                  ? t("Expirado")
                  : `${diasRestantes} ${diasRestantes === 1 ? t("dia") : t("dias")}`}
              </span>
            </div>
          )}
        </div>

        {/* Renovações Rápidas */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground">
            {t("Prorrogação Rápida")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => updateSubscription({ days_to_add: 30 })}
              className="text-xs"
            >
              +30 {t("dias")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => updateSubscription({ days_to_add: 90 })}
              className="text-xs"
            >
              +90 {t("dias")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => updateSubscription({ days_to_add: 365 })}
              className="text-xs"
            >
              +1 {t("ano")}
            </Button>
          </div>
        </div>

        {/* Ajuste de Plano e Data Manual */}
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {t("Alterar Plano")}
            </Label>
            <div className="flex gap-2">
              <Select
                value={selectedPlan}
                onValueChange={(val) => {
                  setSelectedPlan(val);
                  void updateSubscription({ plan: val });
                }}
                disabled={loading}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {t("Data Específica de Vencimento")}
            </Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8 text-xs"
                disabled={loading}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={loading || !customDate}
                onClick={() => {
                  if (customDate) {
                    const iso = new Date(`${customDate}T23:59:59Z`).toISOString();
                    void updateSubscription({ subscription_expires_at: iso });
                  }
                }}
                className="h-8 text-xs shrink-0"
              >
                {t("Salvar")}
              </Button>
            </div>
          </div>

          {subscriptionExpiresAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void updateSubscription({ subscription_expires_at: null })}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              {t("Remover expiração (tornar vitalício)")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
