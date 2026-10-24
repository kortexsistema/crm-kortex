"use client";

import React, { useState, useRef } from "react";
import {
  UploadSimple,
  CircleNotch,
  Warning,
  X,
  Trash,
  Sparkle,
  CaretLeft,
  CaretRight,
  ImageIcon,
  Eye,
} from "@/lib/ui/icons";
import { compressVehicleImage } from "@/lib/vehicles/image-compressor";
import { MAX_PHOTOS_PER_VEHICLE } from "@/lib/vehicles/photos";

interface VehicleGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  vehicle: {
    id: string;
    marca: string;
    modelo: string;
    versao?: string | null;
    fotos_urls: string[];
  } | null;
  onPhotosUpdated: (vehicleId: string, novasFotos: string[]) => void;
  podeEditar: boolean;
}

export function VehicleGalleryModal({
  isOpen,
  onClose,
  vehicle,
  onPhotosUpdated,
  podeEditar,
}: VehicleGalleryModalProps) {
  const [fotos, setFotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [fotoZoom, setFotoZoom] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prevVehicleId, setPrevVehicleId] = useState<string | null>(vehicle?.id ?? null);

  if (vehicle && vehicle.id !== prevVehicleId) {
    setPrevVehicleId(vehicle.id);
    setFotos(vehicle.fotos_urls ?? []);
    setErrorMsg(null);
    setStatusMsg(null);
    setFotoZoom(null);
  }

  if (!isOpen || !vehicle) return null;

  const handleFileSelect = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const vagasRestantes = MAX_PHOTOS_PER_VEHICLE - fotos.length;
    if (vagasRestantes <= 0) {
      setErrorMsg(`Limite de ${MAX_PHOTOS_PER_VEHICLE} fotos já atingido para este veículo.`);
      return;
    }

    const arquivosParaProcessar = fileArray.slice(0, vagasRestantes);
    if (fileArray.length > vagasRestantes) {
      setStatusMsg(`Apenas as primeiras ${vagasRestantes} foto(s) foram selecionadas devido ao limite máximo de ${MAX_PHOTOS_PER_VEHICLE}.`);
    } else {
      setStatusMsg(null);
    }

    setUploading(true);
    setErrorMsg(null);

    try {
      const formData = new FormData();
      let index = 1;

      for (const f of arquivosParaProcessar) {
        setStatusMsg(`Otimizando foto ${index} de ${arquivosParaProcessar.length}...`);
        // Compressão inteligente cliente via Canvas (máx 1920x1080 WebP/JPEG)
        const compressed = await compressVehicleImage(f, {
          maxWidth: 1920,
          maxHeight: 1080,
          quality: 0.85,
        });
        formData.append("files", compressed.file);
        index++;
      }

      setStatusMsg("Enviando fotos para o servidor...");
      const res = await fetch(`/api/v1/vehicles/${vehicle.id}/photos`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.message ?? "Falha ao enviar fotos.");
      }

      const novasFotos = (json.data?.fotos_urls as string[]) ?? [];
      setFotos(novasFotos);
      onPhotosUpdated(vehicle.id, novasFotos);
      setStatusMsg("Fotos enviadas com sucesso!");
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido durante o upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleExcluirFoto = async (photoUrl: string) => {
    if (!confirm("Deseja realmente remover esta foto da galeria?")) return;

    setDeletingUrl(photoUrl);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/v1/vehicles/${vehicle.id}/photos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_url: photoUrl }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.message ?? "Falha ao excluir a foto.");
      }

      const fotosAtualizadas = (json.data?.fotos_urls as string[]) ?? [];
      setFotos(fotosAtualizadas);
      onPhotosUpdated(vehicle.id, fotosAtualizadas);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao remover a foto.");
    } finally {
      setDeletingUrl(null);
    }
  };

  const salvarNovaOrdem = async (novaOrdem: string[]) => {
    setReordering(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicle.id}/photos/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fotos_urls: novaOrdem }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.message ?? "Falha ao salvar ordenação.");
      }

      const atualizadas = (json.data?.fotos_urls as string[]) ?? novaOrdem;
      setFotos(atualizadas);
      onPhotosUpdated(vehicle.id, atualizadas);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao reordenar fotos.");
    } finally {
      setReordering(false);
    }
  };

  const handleDefinirComoCapa = (index: number) => {
    if (index === 0) return;
    const item = fotos[index];
    if (!item) return;
    const novaOrdem = [item, ...fotos.filter((_, i) => i !== index)];
    void salvarNovaOrdem(novaOrdem);
  };

  const handleMoverPosicao = (index: number, direcao: "esquerda" | "direita") => {
    const destino = direcao === "esquerda" ? index - 1 : index + 1;
    if (destino < 0 || destino >= fotos.length) return;

    const origemItem = fotos[index];
    const destinoItem = fotos[destino];
    if (!origemItem || !destinoItem) return;

    const novaOrdem = [...fotos];
    novaOrdem[index] = destinoItem;
    novaOrdem[destino] = origemItem;

    void salvarNovaOrdem(novaOrdem);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                Galeria de Fotos — {vehicle.marca} {vehicle.modelo}
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground border border-border">
                {fotos.length} de {MAX_PHOTOS_PER_VEHICLE} fotos
              </span>
            </div>
            {vehicle.versao && (
              <p className="text-xs text-muted-foreground">{vehicle.versao}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-xs text-destructive">
              <Warning size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMsg && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center gap-2 text-xs text-primary">
              <CircleNotch size={16} className="animate-spin shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {/* Área de Upload / Dropzone */}
          {podeEditar && fotos.length < MAX_PHOTOS_PER_VEHICLE && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files) {
                  void handleFileSelect(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/20"
              } ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    void handleFileSelect(e.target.files);
                  }
                }}
              />
              <div className="flex flex-col items-center gap-2">
                <div className="p-2.5 bg-primary/10 rounded-full text-primary">
                  {uploading ? (
                    <CircleNotch size={24} className="animate-spin" />
                  ) : (
                    <UploadSimple size={24} />
                  )}
                </div>
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    Clique para selecionar
                  </span>{" "}
                  ou arraste novas fotos do veículo aqui
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Suporta JPEG, PNG ou WebP até 5 MB cada. As fotos são otimizadas e comprimidas automaticamente.
                </p>
              </div>
            </div>
          )}

          {/* Grid de Fotos */}
          {fotos.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <div className="p-3 bg-muted/40 rounded-full">
                <ImageIcon size={32} />
              </div>
              <p className="text-sm font-medium text-foreground">
                Nenhuma foto cadastrada para este veículo
              </p>
              <p className="text-xs max-w-sm">
                Envie fotos em alta resolução para que o atendente de WhatsApp da IA Letícia possa apresentá-las aos clientes interessados.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {fotos.map((url, idx) => {
                const isCapa = idx === 0;
                const isDeleting = deletingUrl === url;

                return (
                  <div
                    key={url}
                    className={`group relative rounded-lg border overflow-hidden bg-muted/30 transition-all ${
                      isCapa
                        ? "border-emerald-500 shadow-xs ring-2 ring-emerald-500/20"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    {/* Imagem */}
                    <div className="aspect-4/3 relative overflow-hidden bg-black/5 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`${vehicle.marca} ${vehicle.modelo} - foto ${idx + 1}`}
                        className="w-full h-full object-cover transition-transform group-hover:scale-102"
                        loading="lazy"
                      />

                      {/* Badge de Capa */}
                      {isCapa && (
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white shadow-xs flex items-center gap-1">
                          <Sparkle size={12} weight="fill" />
                          <span>Capa</span>
                        </div>
                      )}

                      {/* Botão de Zoom/Visualização */}
                      <button
                        onClick={() => setFotoZoom(url)}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                        title="Ver em tamanho real"
                      >
                        <Eye size={14} />
                      </button>

                      {/* Overlay durante exclusão */}
                      {isDeleting && (
                        <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                          <CircleNotch size={20} className="animate-spin text-destructive" />
                        </div>
                      )}
                    </div>

                    {/* Barra de Controles Inferiores */}
                    {podeEditar && (
                      <div className="p-1.5 bg-card border-t border-border flex items-center justify-between text-xs">
                        {/* Ações de Reordenação */}
                        <div className="flex items-center gap-0.5">
                          <button
                            disabled={idx === 0 || reordering}
                            onClick={() => handleMoverPosicao(idx, "esquerda")}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            title="Mover para esquerda"
                          >
                            <CaretLeft size={14} />
                          </button>
                          <button
                            disabled={idx === fotos.length - 1 || reordering}
                            onClick={() => handleMoverPosicao(idx, "direita")}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            title="Mover para direita"
                          >
                            <CaretRight size={14} />
                          </button>
                        </div>

                        {/* Botão Tornar Capa ou Indicador */}
                        <div className="flex items-center gap-1">
                          {!isCapa && (
                            <button
                              disabled={reordering}
                              onClick={() => handleDefinirComoCapa(idx)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                              title="Definir esta foto como a capa principal"
                            >
                              Tornar Capa
                            </button>
                          )}

                          {/* Excluir Foto */}
                          <button
                            disabled={isDeleting || reordering}
                            onClick={() => handleExcluirFoto(url)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Remover foto"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {fotos.length > 0
              ? "A primeira foto (Capa) é exibida nos cards de estoque e enviada prioritariamente no WhatsApp."
              : "Cadastre até 15 fotos por veículo."}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 font-medium text-foreground transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Modal de Zoom da Foto */}
      {fotoZoom && (
        <div
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setFotoZoom(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fotoZoom}
              alt="Ampliação da foto"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setFotoZoom(null)}
              className="absolute -top-3 -right-3 p-2 bg-card text-foreground rounded-full shadow-lg border border-border hover:bg-muted transition-colors"
              title="Fechar ampliação"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
