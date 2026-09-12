"use client";

import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { saveExternalSupabase } from "@/app/actions/integrations/saveExternalSupabase";
import { testExternalSupabase } from "@/app/actions/integrations/testExternalSupabase";
import { Badge } from "@/components/ui/badge";

export default function IntegrationsSettingsPage() {
  const t = useT();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !apiKey) {
      toast.error(t("Preencha todos os campos."));
      return;
    }
    setLoading(true);
    try {
      const res = await saveExternalSupabase(url, apiKey);
      if (res.ok) {
        toast.success(t("Conexão salva com sucesso!"));
      } else {
        toast.error(res.error?.message || t("Erro ao salvar conexão."));
      }
    } catch (err: any) {
      toast.error(err.message || t("Erro ao salvar conexão."));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!url || !apiKey) {
      toast.error(t("Preencha todos os campos antes de testar."));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testExternalSupabase(url, apiKey);
      if (res.ok) {
        setTestResult({ success: true, message: res.data?.message || "Sucesso" });
        toast.success(t("Conexão bem-sucedida!"));
      } else {
        setTestResult({ success: false, message: res.error?.message || "Erro" });
        toast.error(t("Falha no teste de conexão."));
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      toast.error(t("Falha no teste de conexão."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Integrações")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Configure integrações com serviços externos para sua organização.")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Supabase Externo")}</CardTitle>
          <CardDescription>
            {t("Conecte um banco Supabase externo para sincronizar dados adicionais.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="supabase_url">{t("URL do Supabase Externo")}</Label>
              <Input
                id="supabase_url"
                type="url"
                placeholder="https://xyzcompany.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supabase_key">{t("API Key (Service Role ou Anon)")}</Label>
              <Input
                id="supabase_key"
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            {testResult && (
              <div className={`p-3 rounded-md text-sm ${testResult.success ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                <div className="flex items-center gap-2">
                  <Badge variant={testResult.success ? "success" : "error"}>
                    {testResult.success ? "Online" : "Offline"}
                  </Badge>
                  <span>{testResult.message}</span>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={loading}>
                {loading ? t("Salvando...") : t("Salvar Configuração")}
              </Button>
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? t("Testando...") : t("Testar Conexão")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
