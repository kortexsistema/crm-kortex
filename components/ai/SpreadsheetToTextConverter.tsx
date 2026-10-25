"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  Link as LinkIcon,
  Upload,
  ClipboardPaste,
  Sparkles,
  Zap,
  Loader2,
} from "lucide-react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { convertSpreadsheetUniversal } from "@/app/actions/integrations/convertSpreadsheetUniversal";

interface Props {
  onConverted: (markdown: string, suggestedTitle: string) => void;
  className?: string;
}

type TabOrigem = "google_sheets" | "arquivo" | "texto";

export function SpreadsheetToTextConverter({ onConverted, className }: Props) {
  const t = useT();
  const [tab, setTab] = useState<TabOrigem>("google_sheets");
  const [sheetUrl, setSheetUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingIa, setLoadingIa] = useState(false);

  async function handleConvert(usarIa: boolean) {
    if (usarIa) {
      setLoadingIa(true);
    } else {
      setLoading(true);
    }

    try {
      if (tab === "google_sheets") {
        if (!sheetUrl.trim()) {
          toast.error(t("Informe a URL da Planilha Google."));
          return;
        }

        const res = await convertSpreadsheetUniversal({
          origem: "google_sheets",
          sheetUrl: sheetUrl.trim(),
          usarIa,
        });

        if (res.ok) {
          onConverted(res.data.markdown, res.data.tituloSugerido);
          toast.success(
            `${t("Planilha convertida com sucesso!")} ${res.data.totalLinhas} ${t("linhas formatadas no formato universal.")}`,
          );
        } else {
          toast.error(res.error.message);
        }
      } else if (tab === "arquivo") {
        if (!file) {
          toast.error(t("Selecione um arquivo de planilha (.xlsx ou .csv)."));
          return;
        }

        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        const res = await convertSpreadsheetUniversal({
          origem: "arquivo",
          fileBase64: base64,
          fileName: file.name,
          usarIa,
        });

        if (res.ok) {
          onConverted(res.data.markdown, res.data.tituloSugerido);
          toast.success(
            `${t("Arquivo convertido com sucesso!")} ${res.data.totalLinhas} ${t("linhas formatadas no formato universal.")}`,
          );
        } else {
          toast.error(res.error.message);
        }
      } else if (tab === "texto") {
        if (!rawText.trim()) {
          toast.error(t("Cole os dados da planilha antes de converter."));
          return;
        }

        const res = await convertSpreadsheetUniversal({
          origem: "texto",
          rawText: rawText.trim(),
          usarIa,
        });

        if (res.ok) {
          onConverted(res.data.markdown, res.data.tituloSugerido);
          toast.success(
            `${t("Dados convertidos com sucesso!")} ${res.data.totalLinhas} ${t("linhas formatadas no formato universal.")}`,
          );
        } else {
          toast.error(res.error.message);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Falha ao converter planilha."));
    } finally {
      setLoading(false);
      setLoadingIa(false);
    }
  }

  const isBusy = loading || loadingIa;

  return (
    <div
      className={`rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-3 ${
        className || ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-emerald-950 dark:text-emerald-300">
            {t("Converter Planilha em Documento de Texto")}
          </span>
        </div>
        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          Universal
        </span>
      </div>

      <p className="text-[11px] text-text-muted">
        {t(
          "Transforme qualquer planilha (estoque de veículos, produtos, serviços) no documento de texto limpo para o agente ler.",
        )}
      </p>

      {/* Abas de entrada */}
      <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
        <button
          type="button"
          onClick={() => setTab("google_sheets")}
          disabled={isBusy}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
            tab === "google_sheets"
              ? "bg-surface shadow-xs text-text border border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          <LinkIcon className="h-3 w-3" />
          {t("Google Sheets")}
        </button>
        <button
          type="button"
          onClick={() => setTab("arquivo")}
          disabled={isBusy}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
            tab === "arquivo"
              ? "bg-surface shadow-xs text-text border border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          <Upload className="h-3 w-3" />
          {t("Arquivo (.xlsx, .csv)")}
        </button>
        <button
          type="button"
          onClick={() => setTab("texto")}
          disabled={isBusy}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
            tab === "texto"
              ? "bg-surface shadow-xs text-text border border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          <ClipboardPaste className="h-3 w-3" />
          {t("Colar Tabela / Células")}
        </button>
      </div>

      {/* Conteúdo da aba selecionada */}
      {tab === "google_sheets" ? (
        <div className="space-y-1">
          <Input
            placeholder="https://docs.google.com/spreadsheets/d/.../edit"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            disabled={isBusy}
            className="text-xs h-8 bg-surface/80"
          />
          <p className="text-[10px] text-text-muted">
            {t("Certifique-se de que a planilha está compartilhada com 'Qualquer pessoa com o link'.")}
          </p>
        </div>
      ) : null}

      {tab === "arquivo" ? (
        <div className="space-y-1">
          <Input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={isBusy}
            className="text-xs h-8 bg-surface/80 cursor-pointer"
          />
          <p className="text-[10px] text-text-muted">
            {t("Selecione sua planilha do Excel (.xlsx) ou arquivo .csv com seu estoque.")}
          </p>
        </div>
      ) : null}

      {tab === "texto" ? (
        <div className="space-y-1">
          <Textarea
            rows={3}
            placeholder={t("Cole aqui as linhas ou células copiadas do Excel ou Google Sheets (Ctrl+V)...")}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={isBusy}
            className="text-xs bg-surface/80 font-mono"
          />
          <p className="text-[10px] text-text-muted">
            {t("Aceita dados separados por vírgula, ponto-e-vírgula ou tabulação de células copiadas.")}
          </p>
        </div>
      ) : null}

      {/* Botões de Ação */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40">
        <div className="text-[10px] text-text-muted">
          {t("O resultado preencherá o campo de texto abaixo para revisão.")}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => handleConvert(false)}
            className="h-7 text-xs gap-1.5 border-emerald-600/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Zap className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            )}
            {loading ? t("Convertendo…") : t("Converter Planilha")}
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => handleConvert(true)}
            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loadingIa ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 text-white" />
            )}
            {loadingIa ? t("Processando IA…") : t("Converter com IA")}
          </Button>
        </div>
      </div>
    </div>
  );
}
