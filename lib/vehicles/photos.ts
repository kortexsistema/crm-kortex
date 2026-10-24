/**
 * Módulo de Fotos de Veículos (Storage, Validação e URLs).
 *
 * Bucket público 'vehicle-photos' para o estoque automotivo do Kortex.
 * URLs públicas permanentes para catálogo web e atendimento comercial via WhatsApp.
 */
import { randomUUID } from "node:crypto";

export const BUCKET_VEHICLE_PHOTOS = "vehicle-photos";

/** Limite de 15 fotos por veículo */
export const MAX_PHOTOS_PER_VEHICLE = 15;

/** 5 MB por foto (limite do bucket na migration 0251) */
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type TipoFotoPermitida = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function comecaCom(bytes: Uint8Array, assinatura: readonly number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((b, i) => bytes[i] === b);
}

/**
 * Identifica o tipo MIME real da imagem a partir dos bytes mágicos.
 * Previne envio de arquivos executáveis disfarçados ou tipos não suportados.
 */
export function farejarTipoFoto(bytes: Uint8Array): TipoFotoPermitida | null {
  if (comecaCom(bytes, PNG_SIGNATURE)) return "image/png";
  if (comecaCom(bytes, JPEG_SIGNATURE)) return "image/jpeg";

  // WebP: Bytes 0-3 "RIFF" (0x52 0x49 0x46 0x46) e Bytes 8-11 "WEBP" (0x57 0x45 0x42 0x50)
  if (bytes.length >= 12) {
    const isRiff =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46;
    const isWebp =
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    if (isRiff && isWebp) return "image/webp";
  }

  return null;
}

/**
 * Retorna a extensão de arquivo recomendada para o MIME type.
 */
export function extensaoDeFoto(tipo: TipoFotoPermitida): string {
  switch (tipo) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}

/**
 * Gera caminho determinístico e não-enumerável no Supabase Storage:
 * `${orgId}/${vehicleId}/${randomUUID()}.${ext}`
 */
export function gerarCaminhoFoto(
  orgId: string,
  vehicleId: string,
  ext: string,
): string {
  const limpoExt = ext.replace(/^\.+/, "");
  return `${orgId}/${vehicleId}/${randomUUID()}.${limpoExt}`;
}

/**
 * Obtém a URL base do Supabase Storage no runtime.
 */
export function obterBaseDoStorage(): string {
  if (typeof window !== "undefined") {
    return (window.__PUBLIC_ENV__?.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  }
  const chave = ["NEXT", "PUBLIC", "SUPABASE", "URL"].join("_");
  return ((process.env as Record<string, string | undefined>)[chave] ?? "").trim();
}

/**
 * Deriva a URL pública completa de uma foto a partir do caminho salvo no bucket.
 */
export function derivarUrlPublica(caminho: string, baseUrl?: string): string {
  const base = (baseUrl ?? obterBaseDoStorage()).replace(/\/+$/, "");
  const limpo = caminho.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${BUCKET_VEHICLE_PHOTOS}/${limpo}`;
}

/**
 * Extrai o caminho relativo dentro do bucket se a URL pertencer à organização e ao bucket de fotos de veículos.
 * Retorna null se for externa ou pertencer a outra organização (proteção contra deleção indevida).
 */
export function extrairCaminhoDoBucket(
  photoUrl: string,
  orgId: string,
): string | null {
  if (!photoUrl || typeof photoUrl !== "string") return null;

  const padraoBucket = `/storage/v1/object/public/${BUCKET_VEHICLE_PHOTOS}/`;
  const idx = photoUrl.indexOf(padraoBucket);
  if (idx === -1) return null;

  const caminhoRelativo = photoUrl.substring(idx + padraoBucket.length).trim();
  if (caminhoRelativo.startsWith(`${orgId}/`)) {
    return caminhoRelativo;
  }

  return null;
}
