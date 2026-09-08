import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte, pixDePagamento, whatsappDeSuporte } from "@/lib/branding/saida";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { PixCopyButton } from "@/components/billing/PixCopyButton";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const suporte = emailDeSuporte();
  const pix = pixDePagamento();
  const whatsappRaw = whatsappDeSuporte();
  const whatsappDigits = whatsappRaw.replace(/\D/g, "");
  const idioma = user.idioma;

  const admin = createAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("plan, subscription_expires_at, status")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

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
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Assinatura e Cobrança", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Gerenciamento do plano corporativo e renovação manual da sua organização.", idioma)}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Card do Plano Atual */}
        <Card className="p-6 space-y-4 flex flex-col justify-between border-border/80 shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {traduzir("Plano Vigente", idioma)}
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
                    ? expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
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
            {traduzir("A renovação deste plano é realizada diretamente com o administrador da sua instalação.", idioma)}
          </div>
        </Card>

        {/* Card de Pagamento Manual PIX */}
        <Card className="p-6 space-y-4 border-border/80 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {traduzir("Renovação Manual via PIX", idioma)}
              </span>
              <span className="text-xs text-muted-foreground font-mono">PIX</span>
            </div>

            {pix ? (
              <div className="rounded-lg border bg-card p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">
                    {traduzir("Chave PIX oficial:", idioma)}
                  </span>
                  <PixCopyButton pixKey={pix} />
                </div>
                <div className="rounded-md bg-muted p-2 font-mono text-xs break-all select-all border text-foreground">
                  {pix}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {traduzir("Chave PIX não cadastrada nas configurações da plataforma.", idioma)}
              </p>
            )}

            <div className="text-xs text-muted-foreground space-y-1 pt-1">
              <p><strong>1.</strong> {traduzir("Efetue o PIX no valor acordado com seu provedor.", idioma)}</p>
              <p><strong>2.</strong> {traduzir("Envie o comprovante para liberação ou extensão da data de validade.", idioma)}</p>
            </div>
          </div>

          {whatsappDigits && (
            <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-medium">
              <a
                href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                  `Olá! Gostaria de renovar a assinatura da organização "${activeOrg.name}" (Plano ${planName}). Segue meu contato.`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>💬</span>
                {traduzir("Falar com o Financeiro no WhatsApp", idioma)}
              </a>
            </Button>
          )}

          {suporte && (
            <p className="text-xs text-muted-foreground text-center">
              {traduzir("Dúvidas financeiras?", idioma)}{" "}
              <a href={`mailto:${suporte}`} className="underline hover:text-foreground">
                {suporte}
              </a>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
