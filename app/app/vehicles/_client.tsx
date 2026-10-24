"use client";

import React, { useState } from "react";
import {
  UploadSimple,
  MagnifyingGlass,
  Storefront,
  ImageIcon,
} from "@/lib/ui/icons";
import { VehicleImportModal } from "@/components/vehicles/VehicleImportModal";
import { VehicleGalleryModal } from "@/components/vehicles/VehicleGalleryModal";
import type { VehicleSafeRow } from "@/lib/vehicles/types";

interface VehiclesClientProps {
  inicial: VehicleSafeRow[];
  podeEditar: boolean;
  nicheId: string;
}

const STATUS_CORES: Record<string, string> = {
  disponivel: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  reservado: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  vendido: "bg-muted text-muted-foreground border-border",
  em_preparacao: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  em_preparacao: "Em Preparação",
};

export function VehiclesClient({ inicial, podeEditar }: VehiclesClientProps) {
  const [veiculos, setVeiculos] = useState<VehicleSafeRow[]>(inicial);
  const [modalImportAberto, setModalImportAberto] = useState(false);
  const [veiculoGaleria, setVeiculoGaleria] = useState<VehicleSafeRow | null>(null);
  const [modalGaleriaAberto, setModalGaleriaAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [_reloading, setReloading] = useState(false);

  const fetchEstoque = async () => {
    setReloading(true);
    try {
      const res = await fetch("/api/v1/vehicles?limite=200");
      if (res.ok) {
        const json = await res.json();
        if (json.data?.veiculos) {
          setVeiculos(json.data.veiculos);
        }
      }
    } catch {
      // Falha silenciosa na atualização em background
    } finally {
      setReloading(false);
    }
  };

  const abrirGaleria = (v: VehicleSafeRow) => {
    setVeiculoGaleria(v);
    setModalGaleriaAberto(true);
  };

  const handleFotosUpdated = (vehicleId: string, novasFotos: string[]) => {
    setVeiculos((prev) =>
      prev.map((item) => (item.id === vehicleId ? { ...item, fotos_urls: novasFotos } : item)),
    );
    if (veiculoGaleria && veiculoGaleria.id === vehicleId) {
      setVeiculoGaleria((prev) => (prev ? { ...prev, fotos_urls: novasFotos } : null));
    }
  };

  const veiculosFiltrados = veiculos.filter((v) => {
    if (filtroStatus !== "todos" && v.status !== filtroStatus) return false;
    if (busca.trim() !== "") {
      const termo = busca.toLowerCase();
      const matchMarca = v.marca.toLowerCase().includes(termo);
      const matchModelo = v.modelo.toLowerCase().includes(termo);
      const matchVersao = v.versao?.toLowerCase().includes(termo) ?? false;
      if (!matchMarca && !matchModelo && !matchVersao) return false;
    }
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Estoque de Veículos</h1>
            <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              Nicho Automotivo
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão do estoque automotivo da empresa, fotos para vitrine e alimentação do catálogo da IA Letícia.
          </p>
        </div>

        {podeEditar && (
          <button
            onClick={() => setModalImportAberto(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm"
          >
            <UploadSimple size={18} weight="bold" />
            <span>Importar Planilha</span>
          </button>
        )}
      </div>

      {/* Filtros e Busca */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
        {/* Barra de Busca */}
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por marca, modelo ou versão..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Filtros de Status */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 text-xs">
          {["todos", "disponivel", "reservado", "em_preparacao", "vendido"].map((st) => (
            <button
              key={st}
              onClick={() => setFiltroStatus(st)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
                filtroStatus === st
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {st === "todos" ? "Todos os Status" : STATUS_LABELS[st] ?? st}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela de Veículos */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Veículo</th>
                <th className="px-4 py-3 font-medium">Ano</th>
                <th className="px-4 py-3 font-medium">Cor</th>
                <th className="px-4 py-3 font-medium">Km</th>
                <th className="px-4 py-3 font-medium">Câmbio / Combustível</th>
                <th className="px-4 py-3 font-medium">Preço de Venda</th>
                <th className="px-4 py-3 font-medium">Placa Final</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium text-right">Galeria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {veiculosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <div className="p-4 bg-muted/40 rounded-full">
                        <Storefront size={32} />
                      </div>
                      <div className="max-w-sm">
                        <p className="font-semibold text-foreground">
                          {veiculos.length === 0
                            ? "Nenhum veículo em estoque ainda"
                            : "Nenhum veículo encontrado com os filtros aplicados"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {veiculos.length === 0
                            ? "Importe sua primeira planilha XLSX ou CSV para cadastrar o catálogo e abastecer o agente de IA."
                            : "Tente alterar os termos da busca ou selecionar outro status."}
                        </p>
                      </div>
                      {veiculos.length === 0 && podeEditar && (
                        <button
                          onClick={() => setModalImportAberto(true)}
                          className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          <UploadSimple size={16} weight="bold" />
                          <span>Importar Planilha</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                veiculosFiltrados.map((v) => {
                  const temFotos = v.fotos_urls && v.fotos_urls.length > 0;
                  const fotoCapa = temFotos ? v.fotos_urls[0] : null;

                  return (
                    <tr key={v.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* Miniatura da Capa ou Placeholder */}
                          <button
                            type="button"
                            onClick={() => abrirGaleria(v)}
                            className="group relative shrink-0 w-12 h-9 rounded-md overflow-hidden bg-muted/40 border border-border hover:border-primary/50 transition-all focus:outline-hidden"
                            title="Abrir galeria de fotos"
                          >
                            {fotoCapa ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={fotoCapa}
                                  alt={`${v.marca} ${v.modelo}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                  loading="lazy"
                                />
                                <span className="absolute bottom-0 right-0 bg-black/75 text-[9px] font-bold text-white px-1 rounded-tl-xs">
                                  {v.fotos_urls.length}
                                </span>
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground group-hover:text-foreground">
                                <ImageIcon size={16} />
                              </div>
                            )}
                          </button>

                          <div>
                            <div className="font-semibold text-foreground">
                              {v.marca} {v.modelo}
                            </div>
                            {v.versao && <div className="text-xs text-muted-foreground">{v.versao}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {v.ano_fabricacao && v.ano_modelo
                          ? `${v.ano_fabricacao}/${v.ano_modelo}`
                          : v.ano_modelo ?? "-"}
                      </td>
                      <td className="px-4 py-3 capitalize text-xs">{v.cor ?? "-"}</td>
                      <td className="px-4 py-3 text-xs">
                        {v.quilometragem !== null
                          ? `${v.quilometragem.toLocaleString("pt-BR")} km`
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                        {v.cambio ? `${v.cambio}` : "-"}
                        {v.combustivel ? ` • ${v.combustivel}` : ""}
                      </td>
                      <td className="px-4 py-3 font-semibold text-emerald-600 dark:text-emerald-400">
                        {v.preco_cents !== null
                          ? (v.preco_cents / 100).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: v.moeda || "BRL",
                            })
                          : "A consultar"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {v.placa_final ? `***${v.placa_final}` : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                            STATUS_CORES[v.status] ?? "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {STATUS_LABELS[v.status] ?? v.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => abrirGaleria(v)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted/50 text-foreground transition-colors"
                          title="Gerenciar galeria de fotos"
                        >
                          <ImageIcon size={14} className="text-muted-foreground" />
                          <span>Fotos ({v.fotos_urls?.length ?? 0})</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Importação de Planilha */}
      <VehicleImportModal
        isOpen={modalImportAberto}
        onClose={() => setModalImportAberto(false)}
        onSuccess={fetchEstoque}
      />

      {/* Modal de Galeria de Fotos */}
      <VehicleGalleryModal
        isOpen={modalGaleriaAberto}
        onClose={() => {
          setModalGaleriaAberto(false);
          setVeiculoGaleria(null);
        }}
        vehicle={veiculoGaleria}
        onPhotosUpdated={handleFotosUpdated}
        podeEditar={podeEditar}
      />
    </div>
  );
}
