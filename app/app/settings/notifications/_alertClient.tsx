"use client";

import { useT } from "@/hooks/i18n/useT";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateHandoffAlertContacts } from "@/app/actions/settings/updateHandoffAlertContacts";

export type HandoffContact = { name: string; phone: string };

export function HandoffAlertClient({ initialContacts }: { initialContacts: HandoffContact[] }) {
  const t = useT();
  const [contacts, setContacts] = useState<HandoffContact[]>(initialContacts);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    if (!newName.trim() || !newPhone.trim()) return;
    setContacts([...contacts, { name: newName.trim(), phone: newPhone.trim() }]);
    setNewName("");
    setNewPhone("");
  };

  const handleRemove = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateHandoffAlertContacts({ handoff_alert_contacts: contacts });
      if (res.ok) {
        toast.success(t("Contatos de alerta salvos com sucesso."));
      } else {
        toast.error(t("Erro ao salvar contatos de alerta."));
      }
    });
  };

  const isDirty = JSON.stringify(contacts) !== JSON.stringify(initialContacts);

  return (
    <Card className="p-4 mt-6">
      <h2 className="text-base font-medium mb-2">{t("Alerta de Handoff via WhatsApp")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("Receba um alerta nestes números quando um cliente pedir atendimento humano. O alerta será enviado automaticamente para todos.")}
      </p>
      
      <div className="space-y-4 max-w-lg">
        {contacts.map((contact, i) => (
          <div key={i} className="flex items-center gap-4">
            <Input value={contact.name} disabled className="bg-muted/50" />
            <Input value={contact.phone} disabled className="bg-muted/50" />
            <Button variant="ghost" size="icon" onClick={() => handleRemove(i)} disabled={isPending}>
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        ))}

        <div className="flex items-center gap-4">
          <Input
            placeholder={t("Nome (ex: Gestor)")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isPending}
          />
          <Input
            placeholder="ex: 5511999999999"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            disabled={isPending}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button variant="outline" size="icon" onClick={handleAdd} disabled={isPending || !newName.trim() || !newPhone.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={handleSave} disabled={isPending || (!isDirty && contacts.length > 0) || (contacts.length === 0 && initialContacts.length === 0)}>
          {isPending ? t("Salvando...") : t("Salvar Contatos")}
        </Button>
      </div>
    </Card>
  );
}
