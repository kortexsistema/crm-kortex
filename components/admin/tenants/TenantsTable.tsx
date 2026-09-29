"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Buildings } from "@/lib/ui/icons";
import type { AdminTenantRow } from "@/hooks/useAdminTenants";
import { useT } from "@/hooks/i18n/useT";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<
  string,
  "success" | "info" | "warning" | "error" | "neutral"
> = {
  active: "success",
  trial: "info",
  expired: "error",
  suspended: "warning",
  redacted: "neutral",
  in_debt: "error",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Assinante Ativo",
  trial: "Em Teste",
  expired: "Vencido",
  suspended: "Suspenso",
  redacted: "Redigido",
  in_debt: "Inadimplente",
};

function StatusBadge({
  status,
  onboardedAt,
  expiresAt,
}: {
  status: string;
  onboardedAt: string | null;
  expiresAt: string | null;
}) {
  const t = useT();
  let effective = status;
  
  if (status === "active") {
    if (!onboardedAt) {
      effective = "trial";
    } else if (expiresAt) {
      const isExpired = new Date(expiresAt) < new Date();
      effective = isExpired ? "expired" : "active";
    }
  }

  return (
    <Badge variant={STATUS_VARIANTS[effective] ?? "neutral"}>
      {t(STATUS_LABELS[effective] ?? effective)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null, idioma: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(idioma, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function extractCount(
  arr: Array<{ count: number }> | null | undefined,
): number {
  if (!arr || arr.length === 0) return 0;
  return arr[0]?.count ?? 0;
}

function shortCnpj(cnpj: string | null): string {
  if (!cnpj) return "—";
  // Show first 8 digits (company root) + ...
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length < 8) return cnpj;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/...`;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function TenantsTableSkeleton() {
  const t = useT();
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Slug",
              t("Nome"),
              "CNPJ",
              t("Status de Acesso"),
              t("Plano / Vencimento"),
              t("Users"),
              t("Conversas"),
              t("Datas"),
              "",
            ].map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 10 }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full max-w-[120px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TenantsTableProps {
  data: AdminTenantRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function TenantsTable({
  data,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: TenantsTableProps) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border py-16 text-center text-muted-foreground">
        <Buildings size={36} weight="duotone" className="opacity-40" aria-hidden />
        <p className="text-sm font-medium">{t("Nenhum tenant encontrado")}</p>
        <p className="max-w-xs text-xs opacity-70">
          {t("Ajuste os filtros ou crie um novo tenant.")}
        </p>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Slug</TableHead>
              <TableHead>{t("Nome")}</TableHead>
              <TableHead className="w-[130px]">CNPJ</TableHead>
              <TableHead className="w-[120px]">{t("Status de Acesso")}</TableHead>
              <TableHead className="w-[150px]">{t("Plano / Vencimento")}</TableHead>
              <TableHead className="w-[65px] text-right">{t("Users")}</TableHead>
              <TableHead className="w-[85px] text-right">{t("Conversas")}</TableHead>
              <TableHead className="w-[150px]">{t("Datas")}</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const expiresAt = row.subscription_expires_at
                ? new Date(row.subscription_expires_at)
                : null;
              const isExpired = expiresAt ? expiresAt < now : false;
              const daysLeft = expiresAt
                ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                : null;

              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.slug}</TableCell>
                  <TableCell className="font-medium">{row.display_name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {shortCnpj(row.cnpj)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} onboardedAt={row.onboarded_at} expiresAt={row.subscription_expires_at ?? null} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase font-medium text-muted-foreground">
                        {row.plan ?? "standard"}
                      </span>
                      {expiresAt ? (
                        isExpired ? (
                          <span className="text-xs font-semibold text-destructive">
                            Expirou em: {formatDate(row.subscription_expires_at ?? null, tagDoIdioma)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Renova em: {formatDate(row.subscription_expires_at ?? null, tagDoIdioma)}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Vitalício</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {extractCount(row.user_count)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {extractCount(row.conversations_count)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>Cad: {formatDate(row.created_at, tagDoIdioma)}</span>
                      {row.suspended_at && (
                        <span className="text-destructive">Susp: {formatDate(row.suspended_at, tagDoIdioma)}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/tenants/${row.id}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {t("Ver")}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t("Carregando...") : t("Carregar mais")}
          </Button>
        </div>
      )}
    </div>
  );
}
