import type { VehicleParsed } from "./types";

/**
 * Mascara placa de veículo para exibição segura sem vazamento de PII.
 * Ex: "ABC1D23" -> "ABC***3", "ABC1234" -> "ABC***4"
 */
export function mascararPlaca(placa?: string | null): string | null {
  if (!placa) return null;
  const limpo = placa.trim().toUpperCase();
  if (limpo.length <= 4) {
    return `***${limpo.slice(-1)}`;
  }
  const prefixo = limpo.slice(0, 3);
  const sufixo = limpo.slice(-1);
  return `${prefixo}***${sufixo}`;
}

/**
 * Mascara chassi mantendo apenas os 3 primeiros e os 4 últimos caracteres (WMI + final de série).
 * Ex: "9BWZZZ377VT004251" -> "9BW***********4251"
 */
export function mascararChassi(chassi?: string | null): string | null {
  if (!chassi) return null;
  const limpo = chassi.trim().toUpperCase();
  if (limpo.length <= 7) {
    return `***${limpo.slice(-3)}`;
  }
  const prefixo = limpo.slice(0, 3);
  const sufixo = limpo.slice(-4);
  const asteriscos = "*".repeat(Math.max(3, limpo.length - 7));
  return `${prefixo}${asteriscos}${sufixo}`;
}

/**
 * Veículo com campos públicos comerciais seguros para pré-visualização no frontend.
 * Garante que campos confidenciais (chassi, placa completa, custos, observações)
 * jamais vazem para o cliente.
 */
export interface SafeVehiclePreview {
  linha: number;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: string | null;
  cambio: string | null;
  quilometragem: number | null;
  preco_cents: number | null;
  moeda: string;
  status: string;
  opcionais: string[];
  fotos_urls: string[];
  placa_final: string | null;
  placa_mascarada: string | null;
  chassi_mascarado: string | null;
}

export function sanitizarVeiculoParaVisualizacao(v: VehicleParsed): SafeVehiclePreview {
  return {
    linha: v.linha,
    marca: v.marca,
    modelo: v.modelo,
    versao: v.versao,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    cor: v.cor,
    combustivel: v.combustivel,
    cambio: v.cambio,
    quilometragem: v.quilometragem,
    preco_cents: v.preco_cents,
    moeda: v.moeda,
    status: v.status,
    opcionais: v.opcionais,
    fotos_urls: v.fotos_urls,
    placa_final: v.placa_final,
    placa_mascarada: mascararPlaca(v.placa_completa),
    chassi_mascarado: mascararChassi(v.chassi),
  };
}
