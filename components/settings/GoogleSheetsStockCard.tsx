"use client";

import { useState, useEffect } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileSpreadsheet, RefreshCw, CheckCircle2, AlertCircle, Clock, Eye, FileText } from "lucide-react";
import { getGoogleSheetsConfig } from "@/app/actions/integrations/getGoogleSheetsConfig";
import { saveGoogleSheetsConfig } from "@/app/actions/integrations/saveGoogleSheetsConfig";
import { syncGoogleSheetsNow } from "@/app/actions/integrations/syncGoogleSheetsNow";
import { convertGoogleSheetsPreview } from "@/app/actions/integrations/convertGoogleSheetsPreview";
import type { GoogleSheetsConfigResponse } from "@/lib/integrations/google-sheets/types";

export function GoogleSheetsStockCard() {
  const t = useT();
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetGid, setSheetGid] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [config, setConfig] = useState<GoogleSheetsConfigResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadConfig = async () => {
    try {
      const res = await getGoogleSheetsConfig();
      if (res.ok && res.data) {
        setConfig(res.data);
        setSheetUrl(res.data.sheet_url || "");
        setSheetGid(res.data.sheet_gid || "");
        setAutoSync(res.data.auto_sync ?? true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    let ativo = true;
    void getGoogleSheetsConfig().then((res) => {
      if (!ativo) return;
      if (res.ok && res.data) {
        setConfig(res.data);
        setSheetUrl(res.data.sheet_url || "");
        setSheetGid(res.data.sheet_gid || "");
        setAutoSync(res.data.auto_sync ?? true);
      }
      setInitialLoading(false);
    }).catch(() => {
      if (ativo) setInitialLoading(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl.trim()) {
      toast.error(t("Informe a URL da Planilha Google."));
      return;
    }

    setLoading(true);
    try {
      const res = await saveGoogleSheetsConfig({
        sheetUrl: sheetUrl.trim(),
        sheetGid: sheetGid.trim() || undefined,
        autoSync,
      });

      if (res.ok) {
        toast.success(t("Configuração da Planilha Google salva com sucesso!"));
        await loadConfig();
      } else {
        toast.error(res.error?.message || t("Erro ao salvar configuração."));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("Erro ao salvar configuração."));
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    if (!sheetUrl.trim()) {
      toast.error(t("Configure a URL da planilha antes de sincronizar."));
      return;
    }

    setSyncing(true);
    try {
      // Se houve alteração no input, salva primeiro
      if (sheetUrl !== config?.sheet_url || autoSync !== config?.auto_sync || sheetGid !== config?.sheet_gid) {
        const saveRes = await saveGoogleSheetsConfig({
          sheetUrl: sheetUrl.trim(),
          sheetGid: sheetGid.trim() || undefined,
          autoSync,
        });
        if (!saveRes.ok) {
          toast.error(saveRes.error?.message || t("Erro ao salvar dados antes de sincronizar."));
          setSyncing(false);
          return;
        }
      }

      const res = await syncGoogleSheetsNow();
      if (res.ok) {
        const d = res.data;
        const msg = `${t("Sincronização concluída!")} ${d.total} ${t("produtos")} (${d.criados} ${t("novos")}, ${d.atualizados} ${t("atualizados")}).`;
        toast.success(msg);
        if (d.erros.length > 0) {
          toast.warning(`${d.erros.length} ${t("linhas ignoradas por divergência de cabeçalho ou valor.")}`);
        }
        await loadConfig();
      } else {
        toast.error(res.error?.message || t("Falha na sincronização da planilha."));
        await loadConfig();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("Erro inesperado durante a sincronização."));
    } finally {
      setSyncing(false);
    }
  };

  if (initialLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t("Carregando integração com Google Sheets...")}</CardContent>
      </Card>
    );
  }

  const isConfigured = Boolean(config?.sheet_url);
  const isHealthy = config?.status === "healthy" && config?.last_sync_status !== "error";
  const hasError = config?.last_sync_status === "error";

  const handlePreview = async () => {
    if (!sheetUrl.trim()) {
      toast.error(t("Informe a URL da planilha antes de pré-visualizar."));
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await convertGoogleSheetsPreview({
        sheetUrl: sheetUrl.trim(),
        sheetGid: sheetGid.trim() || undefined,
      });
      if (res.ok) {
        setPreviewText(res.data.markdown);
        setPreviewOpen(true);
      } else {
        toast.error(res.error.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Falha ao gerar pré-visualização."));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <>
      <Card data-testid="card-google-sheets">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <CardTitle className="text-base">{t("Google Sheets / Sincronização de Estoque")}</CardTitle>
              </div>
              <CardDescription>
                {t("Conecte uma planilha do Google Sheets para atualizar automaticamente o estoque, preços e a base de conhecimento de produtos do agente.")}
              </CardDescription>
            </div>
            <div>
              {isConfigured ? (
                hasError ? (
                  <Badge variant="error" className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t("Atenção")}
                  </Badge>
                ) : isHealthy ? (
                  <Badge variant="success" className="flex items-center gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("Sincronizado")}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t("Configurado")}</Badge>
                )
              ) : (
                <Badge variant="outline">{t("Não configurado")}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="google_sheet_url">{t("URL da Planilha Google (Google Sheets)")}</Label>
              <Input
                id="google_sheet_url"
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5n.../edit"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("Cole o link da sua planilha. Certifique-se de que o compartilhamento está marcado como 'Qualquer pessoa com o link pode ler' ou use 'Publicar na Web' como CSV.")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="google_sheet_gid">{t("Aba / GID (Opcional)")}</Label>
                <Input
                  id="google_sheet_gid"
                  type="text"
                  placeholder="0"
                  value={sheetGid}
                  onChange={(e) => setSheetGid(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("Preencha apenas se os produtos estiverem em uma aba secundária.")}
                </p>
              </div>

              <div className="flex flex-col justify-center space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto_sync_toggle" className="text-sm font-medium cursor-pointer">
                    {t("Sincronização Diária Automática")}
                  </Label>
                  <Switch
                    id="auto_sync_toggle"
                    checked={autoSync}
                    onCheckedChange={setAutoSync}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("A rotina diária atualizará alterações de preços e estoque automaticamente no RAG.")}
                </p>
              </div>
            </div>

            {/* Painel de telemetria / status da última sincronização */}
            {config?.last_sync_at && (
              <div className={`p-3.5 rounded-lg border text-sm ${hasError ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300' : 'bg-muted/40 border-border'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>
                      <strong>{t("Última sincronização:")}</strong>{" "}
                      {new Date(config.last_sync_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {config.last_sync_status === "success" && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span><strong>{config.last_sync_products_count}</strong> {t("produtos")}</span>
                      <span><strong>+{config.last_sync_created_count}</strong> {t("novos")}</span>
                      <span><strong>~{config.last_sync_updated_count}</strong> {t("atualizados")}</span>
                    </div>
                  )}
                </div>

                {hasError && config.last_sync_error && (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400 break-words">
                    <strong>{t("Motivo da recusa:")}</strong> {config.last_sync_error}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="submit" disabled={loading || syncing}>
                {loading ? t("Salvando...") : t("Salvar Configuração")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSyncNow}
                disabled={syncing || loading || !sheetUrl.trim()}
                data-testid="btn-sync-sheets-now"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? t("Sincronizando...") : t("Sincronizar Agora")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handlePreview}
                disabled={previewLoading || !sheetUrl.trim()}
              >
                <Eye className={`mr-2 h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                {previewLoading ? t("Gerando...") : t("Pré-visualizar Documento")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              {t("Documento de Conhecimento Gerado da Planilha")}
            </DialogTitle>
            <DialogDescription>
              {t("Este é o documento de texto universal formatado que o agente de IA consulta nas respostas aos clientes.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs whitespace-pre-wrap">
            {previewText}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
