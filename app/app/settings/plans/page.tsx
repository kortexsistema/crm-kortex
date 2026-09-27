import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte, whatsappDeSuporte } from "@/lib/branding/saida";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBudgetStatus } from "@/lib/ai/budget/check";
import { Progress } from "@/components/ui/progress";

export const dynamic = "force-dynamic";

export default async function PlansAndCreditsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const suporte = emailDeSuporte();
  const whatsappRaw = whatsappDeSuporte();
  const whatsappDigits = whatsappRaw.replace(/\D/g, "");
  const idioma = user.idioma;

  const admin = createAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("plan, subscription_expires_at, status")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  const budget = await getBudgetStatus(activeOrg.orgId);
  const limitCredits = budget.monthly_limit_cents; // $1.00 = 100 créditos, e budget.monthly_limit_cents já está em centavos.
  const consumedCredits = budget.current_month_consumed_cents;
  const pct = limitCredits > 0 ? Math.min(100, Math.round((consumedCredits / limitCredits) * 100)) : 0;
  
  const planName = ((orgRow as { plan?: string })?.plan ?? "standard").toUpperCase();
  const expiresAt = orgRow?.subscription_expires_at ? new Date(orgRow.subscription_expires_at) : null;
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  let statusBadgeVariant: "success" | "warning" | "error" = "success";
  let statusBadgeLabel = traduzir("Ativa", idioma);
  let diasRestantes: number | null = null;

  if (expiresAt) {
    const diffMs = expiresAt.getTime() - now;
    diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diasRestantes <= 0) {
      statusBadgeVariant = "error";
      statusBadgeLabel = traduzir("Expirada", idioma);
    } else if (diasRestantes <= 5) {
      statusBadgeVariant = "warning";
      statusBadgeLabel = traduzir("Vence em breve", idioma);
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Planos e Créditos", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Gerenciamento do plano corporativo, renovação e uso de créditos.", idioma)}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Card do Plano Atual */}
        <Card className="p-6 space-y-4 flex flex-col justify-between border-border/80 shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {traduzir("Resumo do Plano", idioma)}
              </span>
              <Badge variant={statusBadgeVariant}>{statusBadgeLabel}</Badge>
            </div>
            <div className="text-3xl font-extrabold tracking-tight text-foreground">
              {planName}
            </div>
            <div className="pt-2 text-sm text-muted-foreground space-y-1.5">
              <div className="flex items-center justify-between border-b pb-1.5 text-xs">
                <span>{traduzir("Vencimento da Assinatura", idioma)}</span>
                <strong className="text-foreground">
                  {expiresAt
                    ? expiresAt.toLocaleDateString(idioma, { day: "2-digit", month: "2-digit", year: "numeric" })
                    : traduzir("Vitalício / Indeterminado", idioma)}
                </strong>
              </div>
              {diasRestantes !== null && (
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span>{traduzir("Período Restante", idioma)}</span>
                  <span className={diasRestantes <= 5 ? "font-semibold text-amber-600 dark:text-amber-400" : "font-medium text-foreground"}>
                    {diasRestantes <= 0
                      ? traduzir("Expirado", idioma)
                      : `${diasRestantes} ${diasRestantes === 1 ? traduzir("dia", idioma) : traduzir("dias", idioma)}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            {traduzir("A renovação e alteração deste plano são realizadas diretamente com o suporte.", idioma)}
          </div>
        </Card>

        {/* Card de Uso de Créditos */}
        <Card className="p-6 space-y-4 border-border/80 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {traduzir("Uso de Créditos", idioma)}
              </span>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{traduzir("Créditos Utilizados", idioma)}</span>
                <span className="font-semibold">
                  {consumedCredits.toLocaleString(idioma)} / {limitCredits > 0 ? limitCredits.toLocaleString(idioma) : "∞"}
                </span>
              </div>
              {limitCredits > 0 ? (
                <Progress value={pct} className="h-2" />
              ) : (
                <Progress value={0} className="h-2" />
              )}
              <p className="text-xs text-muted-foreground pt-1">
                {traduzir("Cada ação da Inteligência Artificial consome uma fração de créditos. ($1.00 de custo = 100 créditos).", idioma)}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-4">
            {whatsappDigits ? (
              <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-medium">
                <a
                  href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                    `Olá! Gostaria de falar sobre o plano e solicitar mais créditos para a organização "${activeOrg.name}" (Plano ${planName}).`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>💬</span>
                  {traduzir("Solicitar Mais Créditos / Upgrade", idioma)}
                </a>
              </Button>
            ) : suporte ? (
              <Button asChild variant="outline" className="w-full">
                <a href={`mailto:${suporte}?subject=${encodeURIComponent(`Upgrade de Plano - ${activeOrg.name}`)}`}>
                  ✉️ {traduzir("Solicitar Mais Créditos por E-mail", idioma)}
                </a>
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

