"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  BUSINESS_NICHE_MAP,
  getActiveBusinessNiches,
  type BusinessNiche,
} from "@/lib/niches/types";

interface TenantNicheCardProps {
  organizationId: string;
  nicheId?: string | null;
}

export function TenantNicheCard({
  organizationId,
  nicheId = "ecommerce",
}: TenantNicheCardProps) {
  const t = useT();
  const queryClient = useQueryClient();

  const currentNiche = (nicheId as BusinessNiche) in BUSINESS_NICHE_MAP
    ? (nicheId as BusinessNiche)
    : "ecommerce";

  const [selectedNiche, setSelectedNiche] = useState<BusinessNiche>(currentNiche);
  const [loading, setLoading] = useState(false);

  const meta = BUSINESS_NICHE_MAP[currentNiche];
  const activeNiches = getActiveBusinessNiches();

  const handleSave = async () => {
    if (selectedNiche === currentNiche) {
      toast.info(t("Nenhum nicho diferente foi selecionado."));
      return;
    }

    setLoading(true);
    try {
      await apiClient.patch(`/api/v1/admin/tenants/${organizationId}/niche`, {
        niche_id: selectedNiche,
      });

      toast.success(t("Nicho da organização atualizado com sucesso."));
      await queryClient.invalidateQueries({ queryKey: ["admin", "tenant", organizationId] });
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || t("Erro ao atualizar o nicho da organização."));
      } else {
        const msg = err instanceof Error ? err.message : t("Falha na atualização.");
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{t("Nicho de Negócio")}</CardTitle>
          <Badge variant="neutral" className="uppercase text-[10px] tracking-wider">
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("Segmento de mercado ativo para esta organização. Define quais ferramentas especializadas, esquemas de dados e regras de atendimento são disponibilizados para os agentes e atendentes.")}
        </p>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-foreground">
            {t("Alterar segmento:")}
          </label>
          <Select
            value={selectedNiche}
            onValueChange={(val) => setSelectedNiche(val as BusinessNiche)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("Selecione um nicho")} />
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

        <Button
          onClick={() => { void handleSave(); }}
          disabled={loading || selectedNiche === currentNiche}
          size="sm"
          className="w-full"
        >
          {loading ? t("Salvando…") : t("Salvar nicho")}
        </Button>
      </CardContent>
    </Card>
  );
}
