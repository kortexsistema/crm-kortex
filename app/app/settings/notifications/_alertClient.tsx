"use client";

import { useT } from "@/hooks/i18n/useT";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateHandoffAlertPhone } from "@/app/actions/settings/updateHandoffAlertPhone";

export function HandoffAlertClient({ initialPhone }: { initialPhone: string }) {
  const t = useT();
  const [phone, setPhone] = useState(initialPhone);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateHandoffAlertPhone({ handoff_alert_phone: phone });
      if (res.ok) {
        toast.success(t("Número de alerta salvo com sucesso."));
      } else {
        toast.error(t("Erro ao salvar número de alerta."));
      }
    });
  };

  return (
    <Card className="p-4 mt-6">
      <h2 className="text-base font-medium mb-2">{t("Alerta de Handoff via WhatsApp")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("Receba um alerta neste número quando um cliente pedir atendimento humano. O alerta será enviado automaticamente.")}
      </p>
      <div className="flex items-center gap-4 max-w-sm">
        <Input
          placeholder="ex: 5511999999999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={isPending}
        />
        <Button onClick={handleSave} disabled={isPending || phone === initialPhone}>
          {t("Salvar")}
        </Button>
      </div>
    </Card>
  );
}
