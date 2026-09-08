"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "@/lib/ui/icons";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

export function PixCopyButton({ pixKey }: { pixKey: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!pixKey) return;
    const ok = await copyToClipboard(pixKey);
    if (ok) {
      setCopied(true);
      toast.success(t("Chave PIX copiada com sucesso!"));
      setTimeout(() => setCopied(false), 3000);
    } else {
      toast.error(t("Não foi possível copiar. Selecione e copie manualmente."));
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={handleCopy}
      className="gap-1.5 font-medium shrink-0"
    >
      {copied ? (
        <>
          <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
          <span>{t("Copiado!")}</span>
        </>
      ) : (
        <>
          <Copy size={14} />
          <span>{t("Copiar chave PIX")}</span>
        </>
      )}
    </Button>
  );
}
