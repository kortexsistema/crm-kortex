import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

interface FeatureGatedViewProps {
  title: string;
  description: string;
  featureName: string;
  planName?: string;
  locale?: Idioma;
}

export function FeatureGatedView({
  title,
  description,
  featureName,
  planName,
  locale = "pt-BR",
}: FeatureGatedViewProps) {
  return (
    <div className="flex h-[80vh] items-center justify-center p-4">
      <Card className="max-w-md w-full text-center shadow-lg">
        <CardHeader className="space-y-4">
          <div className="mx-auto bg-muted/50 p-4 rounded-full w-fit">
            <LockKeyhole className="h-10 w-10 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{traduzir(title, locale)}</CardTitle>
          <CardDescription className="text-base">
            {traduzir(description, locale)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-primary/5 border border-primary/20 rounded-md p-4 text-sm text-primary">
            {traduzir("O recurso ", locale)}
            <strong className="font-semibold">{traduzir(featureName, locale)}</strong>
            {traduzir(" não está disponível no seu plano atual", locale)}
            {planName ? ` (${planName.toUpperCase()}).` : "."}
          </div>
          
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/app/settings/billing">
                {traduzir("Fazer Upgrade de Plano", locale)}
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link href="/app">
                {traduzir("Voltar ao Início", locale)}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
