import Link from "next/link";
import { emailDeSuporte, pixDePagamento, whatsappDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { PixCopyButton } from "@/components/billing/PixCopyButton";

export const metadata = {
  title: "Conta suspensa",
};

interface AccountSuspendedProps {
  searchParams?: Promise<{ reason?: string }>;
}

export default async function AccountSuspendedPage({ searchParams }: AccountSuspendedProps) {
  const params = searchParams ? await searchParams : {};
  const isExpired = params.reason === "expired";

  const suporte = emailDeSuporte();
  const pix = pixDePagamento();
  const whatsappRaw = whatsappDeSuporte();
  const whatsappDigits = whatsappRaw.replace(/\D/g, "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );

  const titulo = isExpired
    ? traduzir("Assinatura expirada", idioma)
    : traduzir("Conta suspensa", idioma);

  const descricao = isExpired
    ? traduzir(
        "O período de vigência da sua assinatura terminou. Para reativar o acesso imediatamente, realize o pagamento via PIX e envie o comprovante pelo WhatsApp.",
        idioma,
      )
    : traduzir(
        "Sua conta está temporariamente suspensa pelo administrador da plataforma. Entre em contato para saber o motivo e regularizar o acesso.",
        idioma,
      );

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-8 bg-muted/20">
      <Card className="w-full max-w-lg p-6 sm:p-8 text-center space-y-6 shadow-md">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 text-2xl">
            {isExpired ? "⏳" : "🔒"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{titulo}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{descricao}</p>
        </div>

        {/* Chave PIX se configurada */}
        {pix && (
          <div className="rounded-lg border bg-card/60 p-4 text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {traduzir("Chave PIX para renovação", idioma)}
              </span>
              <PixCopyButton pixKey={pix} />
            </div>
            <div className="rounded-md bg-muted p-2.5 font-mono text-xs break-all select-all border border-border/50 text-foreground">
              {pix}
            </div>
          </div>
        )}

        {/* Ações de contato */}
        <div className="flex flex-col gap-2.5 pt-2">
          {whatsappDigits && (
            <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-medium">
              <a
                href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                  `Olá! Segue o comprovante de pagamento para renovação do CRM (${user?.email ?? "meu acesso"}).`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>💬</span>
                {traduzir("Enviar comprovante via WhatsApp", idioma)}
              </a>
            </Button>
          )}

          {suporte && (
            <p className="text-xs text-muted-foreground pt-1">
              {traduzir("Dúvidas? Escreva para", idioma)}{" "}
              <a href={`mailto:${suporte}`} className="underline hover:text-foreground">
                {suporte}
              </a>
            </p>
          )}

          <div className="pt-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">{traduzir("Voltar para o login", idioma)}</Link>
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
