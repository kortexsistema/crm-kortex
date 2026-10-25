"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { updateTenantNiche } from "@/app/actions/settings/updateTenantNiche";
import {
  BUSINESS_NICHE_MAP,
  getActiveBusinessNiches,
  type BusinessNiche,
} from "@/lib/niches/types";

interface Props {
  readonly currentNiche: string;
}

export function TenantNicheSettingsCard({ currentNiche }: Props) {
  const t = useT();
  const router = useRouter();

  const validatedCurrent = (currentNiche as BusinessNiche) in BUSINESS_NICHE_MAP
    ? (currentNiche as BusinessNiche)
    : "ecommerce";

  const [selectedNiche, setSelectedNiche] = useState<BusinessNiche>(validatedCurrent);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const currentMeta = BUSINESS_NICHE_MAP[validatedCurrent];
  const activeNiches = getActiveBusinessNiches();

  function handleSaveClick() {
    if (selectedNiche === validatedCurrent) {
      toast.info(t("Nenhum segmento diferente foi selecionado."));
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirmedChange() {
    setConfirmOpen(false);
    startTransition(async () => {
      const res = await updateTenantNiche({ niche_id: selectedNiche });
      if (res.ok) {
        toast.success(t("Segmento de negócio atualizado com sucesso."));
        router.refresh();
      } else {
        toast.error(`${t("Erro ao atualizar o nicho")}: ${res.error}`);
      }
    });
  }

  return (
    <>
      <Card className="max-w-2xl border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">{t("Nicho de Negócio")}</CardTitle>
            <Badge variant="neutral" className="uppercase text-[11px] font-medium tracking-wide">
              {currentMeta.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t(
              "Define o segmento operacional da sua empresa no sistema. Altera dinamicamente os atalhos do CRM (entre Catálogo de Produtos e Estoque de Veículos) e ativa as ferramentas especializadas de IA para responder clientes no WhatsApp com base no catálogo correto.",
            )}
          </p>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-foreground">
              {t("Segmento operacional da empresa:")}
            </label>
            <Select
              value={selectedNiche}
              onValueChange={(val) => setSelectedNiche(val as BusinessNiche)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeNiches.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleSaveClick}
              disabled={isPending || selectedNiche === validatedCurrent}
              size="sm"
            >
              {isPending ? t("Salvando…") : t("Alterar segmento")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmar alteração de nicho de negócio")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Você está alterando o segmento da organização para ",
              )}
              <strong>{BUSINESS_NICHE_MAP[selectedNiche]?.label}</strong>.
              {" "}
              {t(
                "Os menus da barra lateral do CRM serão ajustados e o atendente de inteligência artificial passará a utilizar as ferramentas exclusivas deste segmento. Deseja continuar?",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmedChange();
              }}
              disabled={isPending}
            >
              {isPending ? t("Atualizando…") : t("Sim, alterar segmento")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
