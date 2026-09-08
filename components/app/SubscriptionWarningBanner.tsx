"use client";

import Link from "next/link";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";

export function SubscriptionWarningBanner({
  diasRestantes,
}: {
  diasRestantes: number | null;
}) {
  const t = useT();

  if (diasRestantes === null || diasRestantes > 5 || diasRestantes < 0) {
    return null;
  }

  const textoDias =
    diasRestantes === 0
      ? t("Sua assinatura expira hoje!")
      : diasRestantes === 1
        ? t("Sua assinatura expira amanhã!")
        : `${t("Sua assinatura expira em")} ${diasRestantes} ${t("dias.")}`;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100/95 px-4 py-2 text-sm text-amber-950 backdrop-blur dark:border-amber-800/60 dark:bg-amber-950/70 dark:text-amber-50"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>⚠️</span>
        <span>
          <strong>{textoDias}</strong>{" "}
          {t("Efetue a renovação para manter o acesso ininterrupto.")}
        </span>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-7 border-amber-400 bg-white/80 hover:bg-white text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:hover:bg-amber-900 dark:text-amber-100 font-medium"
      >
        <Link href="/app/settings/billing">{t("Ver dados para PIX")}</Link>
      </Button>
    </div>
  );
}
