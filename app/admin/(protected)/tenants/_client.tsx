"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/ui/icons";
import { TenantsFilters } from "@/components/admin/tenants/TenantsFilters";
import {
  TenantsTable,
  TenantsTableSkeleton,
} from "@/components/admin/tenants/TenantsTable";
import { useAdminTenants, type AdminTenantsFilters } from "@/hooks/useAdminTenants";
import { useT } from "@/hooks/i18n/useT";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CreditCard, Users, AlertTriangle } from "lucide-react";

export function TenantsClient() {
  const t = useT();
  const [filters, setFilters] = useState<AdminTenantsFilters>({});

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAdminTenants(filters);

  const rows = data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const total = rows.length;

  const activeCount = rows.filter((r) => r.status === "active").length;
  const suspendedCount = rows.filter((r) => r.status === "suspended").length;
  const mrrCents = rows.filter((r) => r.status === "active").reduce((acc, row) => acc + (row.saas_subscription_value_cents || 0), 0);
  const mrrBrl = (mrrCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const inDebtCount = rows.filter((r) => r.saas_enforcement_mode === "bloquear").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Tenants")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading ? t("Carregando...") : `${total} tenant${total !== 1 ? "s" : ""}${hasNextPage ? "+" : ""}`}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/admin/tenants/new">
            <Plus size={16} aria-hidden />
            {t("Novo tenant")}
          </Link>
        </Button>
      </div>

      {/* Metrics Header */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("MRR Estimado")}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mrrBrl}</div>
            <p className="text-xs text-muted-foreground">
              {t("Baseado nos tenants ativos visíveis")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Tenants Ativos")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="text-xs text-muted-foreground">
              {t("Instalações em operação")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Tenants Suspensos")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suspendedCount}</div>
            <p className="text-xs text-muted-foreground">
              {t("Instalações pausadas")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Em Inadimplência")}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inDebtCount}</div>
            <p className="text-xs text-muted-foreground">
              {t("Enforcement mode: bloquear")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <TenantsFilters filters={filters} onChange={setFilters} />

      {/* Table */}
      {isLoading ? (
        <TenantsTableSkeleton />
      ) : (
        <TenantsTable
          data={rows}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}
    </div>
  );
}
