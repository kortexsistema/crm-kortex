"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateAppointmentReminders } from "@/app/actions/settings/updateAppointmentReminders";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  config: {
    enabled: boolean;
    hours_before: number;
    custom_prompt?: string;
  };
}

const ERROS: Record<string, string> = {
  validation_failed: "Algum campo não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo para salvar.",
  forbidden_tenant: "Não consegui identificar sua empresa. Recarregue a página.",
  forbidden_role: "Você não tem permissão para alterar as automações.",
  nao_gravou: "A alteração não chegou ao banco. Tente de novo.",
};

export function LembretesForm({ config }: Props) {
  const router = useRouter();
  const t = useT();
  const [isPending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(config.enabled);
  const [hours, setHours] = useState(String(config.hours_before));
  const [prompt, setPrompt] = useState(config.custom_prompt || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateAppointmentReminders({
        enabled,
        hours_before: Number(hours) || 24,
        custom_prompt: prompt,
      });

      if (!res.ok) {
        toast.error(t(ERROS[res.error as keyof typeof ERROS] || "Erro desconhecido."));
      } else {
        toast.success(t("Lembretes atualizados com sucesso."));
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-3xl">
      <Card className="p-6 flex flex-row items-center justify-between shadow-sm">
        <div className="space-y-0.5">
          <Label className="text-base">{t("Ativar Disparos Automáticos")}</Label>
          <p className="text-sm text-muted-foreground">
            {t("O robô irá varrer as agendas (nativa e integrações) e enviar as mensagens sozinho.")}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isPending} />
      </Card>

      <Card className="p-6 flex flex-col gap-6 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="hours">{t("Horas de Antecedência")}</Label>
          <Input 
            id="hours"
            type="number" 
            min="1" 
            max="72" 
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={!enabled || isPending}
            className="w-32"
          />
          <p className="text-sm text-muted-foreground">
            {t("Quanto tempo antes do compromisso a mensagem deve ser enviada? (Recomendado: 24)")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="prompt">{t("Tom de Voz / Instrução Extra (Opcional)")}</Label>
          <Textarea 
            id="prompt"
            placeholder={t("Ex: Seja muito simpático, use emojis e sempre chame pelo primeiro nome.")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!enabled || isPending}
            className="min-h-[120px] resize-y"
          />
          <p className="text-sm text-muted-foreground">
            {t("Esta regra é somada ao comportamento base da IA no momento de redigir o lembrete.")}
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("Salvando...") : t("Salvar alterações")}
        </Button>
      </div>
    </form>
  );
}
