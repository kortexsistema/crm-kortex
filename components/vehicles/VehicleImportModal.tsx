"use client";

import React, { useState, useRef } from "react";
import {
  UploadSimple,
  CircleNotch,
  CheckCircle,
  Warning,
  X,
  FileText,
  Info,
} from "@/lib/ui/icons";
import type { VehiclePreviewApiResponse, VehicleConfirmApiResponse } from "@/lib/vehicles/types";

interface VehicleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function VehicleImportModal({ isOpen, onClose, onSuccess }: VehicleImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<VehiclePreviewApiResponse | null>(null);
  const [confirmData, setConfirmData] = useState<VehicleConfirmApiResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"amostra" | "duplicatas" | "erros">("amostra");

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const lower = selected.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      setErrorMsg("Formato não suportado. Por favor, envie uma planilha .xlsx ou .csv.");
      return;
    }

    if (selected.size > 10 * 1024 * 1024) {
      setErrorMsg("O arquivo excede o limite máximo permitido de 10 MB.");
      return;
    }

    setErrorMsg(null);
    setFile(selected);
    setPreviewData(null);
    setConfirmData(null);
  };

  const handleGerarPreview = async () => {
    if (!file) return;

    setPreviewLoading(true);
    setErrorMsg(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/vehicles/import/preview", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.message ?? "Falha ao processar a pré-visualização.");
      }

      setPreviewData(json.data);
      if (json.data.resumo.validos_count === 0 && json.data.resumo.erros_count > 0) {
        setActiveTab("erros");
      } else if (json.data.resumo.validos_count === 0 && json.data.resumo.duplicatas_planilha_count > 0) {
        setActiveTab("duplicatas");
      } else {
        setActiveTab("amostra");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido ao gerar pré-visualização.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmarImportacao = async () => {
    if (!file || !previewData) return;

    setConfirmLoading(true);
    setErrorMsg(null);

    try {
      const idempotencyKey = crypto.randomUUID();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("batch_id", previewData.batch_id);
      formData.append("idempotency_key", idempotencyKey);

      const res = await fetch("/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.message ?? "Falha ao confirmar a importação.");
      }

      setConfirmData(json.data);
      onSuccess();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro inesperado ao confirmar importação.");
    } finally {
      setConfirmLoading(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setPreviewData(null);
    setConfirmData(null);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 text-primary rounded-lg">
              <UploadSimple size={20} weight="bold" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Importar Estoque de Veículos</h2>
              <p className="text-xs text-muted-foreground">Envio seguro de planilhas XLSX e CSV com validação prévia</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
              <Warning size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Atenção: </span>
                {errorMsg}
              </div>
            </div>
          )}

          {/* Success State */}
          {confirmData ? (
            <div className="py-8 text-center space-y-4">
              <div className="inline-flex p-3 bg-emerald-500/10 text-emerald-500 rounded-full">
                <CheckCircle size={48} weight="fill" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Importação Concluída com Sucesso!</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Foram persistidos com sucesso <strong>{confirmData.imported_count}</strong> veículos no estoque da sua empresa.
              </p>
              <div className="inline-grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-xl border border-border text-center">
                <div>
                  <div className="text-xl font-bold text-emerald-500">{confirmData.imported_count}</div>
                  <div className="text-xs text-muted-foreground">Importados</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-amber-500">{confirmData.duplicate_count}</div>
                  <div className="text-xs text-muted-foreground">Duplicados</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-muted-foreground">{confirmData.error_count}</div>
                  <div className="text-xs text-muted-foreground">Inválidos</div>
                </div>
              </div>
              <div className="pt-4 flex justify-center gap-3">
                <button
                  onClick={resetAll}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  Importar Outra Planilha
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Concluir e Ver Estoque
                </button>
              </div>
            </div>
          ) : !previewData ? (
            /* Upload State */
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 text-center cursor-pointer bg-muted/10 hover:bg-muted/20"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .csv"
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 bg-muted rounded-full text-muted-foreground">
                    <FileText size={32} />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {file ? file.name : "Clique para selecionar ou arraste o arquivo XLSX / CSV"}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {file
                        ? `${(file.size / 1024).toFixed(1)} KB selecionado`
                        : "Suporte a planilhas Excel (.xlsx) e arquivos delimitados (.csv) até 10 MB"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Info size={16} />
                  <span>Diretrizes e integridade de importação:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>Colunas identificadas automaticamente (Marca, Modelo, Ano, Km, Preço, Cor, Câmbio, Combustível, etc.).</li>
                  <li>Veículos já cadastrados (por chassi ou placa) são detectados e não substituem o estoque existente.</li>
                  <li>Campos confidenciais (chassi, placa completa e custos internos) são mantidos restritos e protegidos.</li>
                  <li>A etapa de pré-visualização é 100% segura e não altera dados no banco.</li>
                </ul>
              </div>

              {file && (
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={resetAll}
                    disabled={previewLoading}
                    className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    Remover
                  </button>
                  <button
                    onClick={handleGerarPreview}
                    disabled={previewLoading}
                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {previewLoading ? (
                      <>
                        <CircleNotch size={16} className="animate-spin" />
                        <span>Validando planilha...</span>
                      </>
                    ) : (
                      <span>Gerar Pré-visualização</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Preview State */
            <div className="space-y-6">
              {/* Resumo em Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/40 rounded-lg border border-border text-center">
                  <span className="text-xs text-muted-foreground">Total de Linhas</span>
                  <div className="text-xl font-bold text-foreground">{previewData.resumo.total_linhas}</div>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-center">
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">Veículos Elegíveis</span>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {previewData.resumo.validos_count}
                  </div>
                </div>
                <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-center">
                  <span className="text-xs text-amber-600 dark:text-amber-400">Duplicidades</span>
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {previewData.resumo.duplicatas_planilha_count + previewData.resumo.duplicatas_estoque_count}
                  </div>
                </div>
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 text-center">
                  <span className="text-xs text-destructive">Linhas com Erro</span>
                  <div className="text-xl font-bold text-destructive">{previewData.resumo.erros_count}</div>
                </div>
              </div>

              {/* Tabs de Detalhamento */}
              <div className="border-b border-border flex gap-4 text-sm">
                <button
                  onClick={() => setActiveTab("amostra")}
                  className={`pb-2 font-medium border-b-2 transition-colors ${
                    activeTab === "amostra"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Veículos Prontos para Inserir ({previewData.resumo.validos_count})
                </button>
                <button
                  onClick={() => setActiveTab("duplicatas")}
                  className={`pb-2 font-medium border-b-2 transition-colors ${
                    activeTab === "duplicatas"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Duplicatas Ignoradas ({previewData.duplicatas.length})
                </button>
                <button
                  onClick={() => setActiveTab("erros")}
                  className={`pb-2 font-medium border-b-2 transition-colors ${
                    activeTab === "erros"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Erros na Planilha ({previewData.erros.length})
                </button>
              </div>

              {/* Conteúdo das Tabs */}
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
                {activeTab === "amostra" && (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border text-muted-foreground sticky top-0">
                      <tr>
                        <th className="p-2">Linha</th>
                        <th className="p-2">Veículo</th>
                        <th className="p-2">Ano</th>
                        <th className="p-2">Cor</th>
                        <th className="p-2">Km</th>
                        <th className="p-2">Preço</th>
                        <th className="p-2">Placa Final</th>
                        <th className="p-2">Combustível</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewData.amostra_veiculos.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-4 text-center text-muted-foreground">
                            Nenhum veículo novo elegível para importação nesta planilha.
                          </td>
                        </tr>
                      ) : (
                        previewData.amostra_veiculos.map((v, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="p-2 font-mono text-muted-foreground">{v.linha}</td>
                            <td className="p-2 font-medium text-foreground">
                              {v.marca} {v.modelo} {v.versao ?? ""}
                            </td>
                            <td className="p-2">
                              {v.ano_fabricacao && v.ano_modelo
                                ? `${v.ano_fabricacao}/${v.ano_modelo}`
                                : v.ano_modelo ?? "-"}
                            </td>
                            <td className="p-2 capitalize">{v.cor ?? "-"}</td>
                            <td className="p-2">
                              {v.quilometragem !== null ? `${v.quilometragem.toLocaleString("pt-BR")} km` : "-"}
                            </td>
                            <td className="p-2 font-semibold text-emerald-600 dark:text-emerald-400">
                              {v.preco_cents !== null
                                ? (v.preco_cents / 100).toLocaleString("pt-BR", {
                                    style: "currency",
                                    currency: v.moeda || "BRL",
                                  })
                                : "A consultar"}
                            </td>
                            <td className="p-2 font-mono">{v.placa_final ? `***${v.placa_final}` : "-"}</td>
                            <td className="p-2 capitalize">{v.combustivel ?? "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {activeTab === "duplicatas" && (
                  <div className="p-3 divide-y divide-border text-xs">
                    {previewData.duplicatas.length === 0 ? (
                      <p className="text-muted-foreground p-2 text-center">Nenhuma duplicidade encontrada.</p>
                    ) : (
                      previewData.duplicatas.map((d, i) => (
                        <div key={i} className="py-2 flex items-start gap-2">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded-md text-[10px]">Linha {d.linha}</span>
                          <div className="flex-1">
                            <span className="font-medium text-amber-500 uppercase">[{d.tipo}]</span>{" "}
                            <span className="text-foreground">{d.mensagem}</span>
                            {d.identificador_mascarado && (
                              <span className="ml-2 font-mono text-muted-foreground">({d.identificador_mascarado})</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === "erros" && (
                  <div className="p-3 divide-y divide-border text-xs">
                    {previewData.erros.length === 0 ? (
                      <p className="text-muted-foreground p-2 text-center">Nenhum erro de formatação detectado.</p>
                    ) : (
                      previewData.erros.map((err, i) => (
                        <div key={i} className="py-2 flex items-start gap-2">
                          <span className="font-mono bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-md text-[10px]">
                            Linha {err.linha}
                          </span>
                          <div className="flex-1">
                            {err.campo && <span className="font-medium text-foreground capitalize">[{err.campo}] </span>}
                            <span className="text-muted-foreground">{err.motivo}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <button
                  onClick={resetAll}
                  disabled={confirmLoading}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  Voltar e Enviar Outro
                </button>
                <button
                  onClick={handleConfirmarImportacao}
                  disabled={confirmLoading || previewData.resumo.validos_count === 0}
                  className="px-5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {confirmLoading ? (
                    <>
                      <CircleNotch size={16} className="animate-spin" />
                      <span>Gravando no Estoque...</span>
                    </>
                  ) : (
                    <span>Confirmar Importação de {previewData.resumo.validos_count} Veículos</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
