import Link from "next/link";
import { emailDeSuporte, whatsappDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = {
  title: "Conta aguardando aprovação",
};

export default async function AccountPendingPage() {
  const suporte = emailDeSuporte();
  const whatsappRaw = whatsappDeSuporte();
  const whatsappDigits = whatsappRaw.replace(/\D/g, "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );

  const titulo = traduzir("Conta em Análise", idioma);
  const descricao = traduzir(
    "Seu cadastro foi recebido com sucesso. Por questões de segurança, novas contas passam por uma rápida análise antes da liberação total da plataforma. Entraremos em contato assim que o acesso for aprovado.",
    idioma,
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-8 bg-muted/20">
      <Card className="w-full max-w-lg p-6 sm:p-8 text-center space-y-6 shadow-md">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-2xl">
            📋
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{titulo}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{descricao}</p>
        </div>

        {/* Ações de contato */}
        <div className="flex flex-col gap-2.5 pt-2">
          {whatsappDigits && (
            <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-medium">
              <a
                href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                  `Olá! Gostaria de saber o status da aprovação da minha conta (${user?.email ?? ""}).`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>💬</span>
                {traduzir("Falar com o atendimento via WhatsApp", idioma)}
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
