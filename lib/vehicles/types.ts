/**
 * TIPOS E SCHEMAS DO MÓDULO DE VEÍCULOS & AUTOMOTIVO
 */

export const VEHICLE_STATUSES = [
  "disponivel",
  "reservado",
  "vendido",
  "em_preparacao",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_COMBUSTIVEIS = [
  "flex",
  "gasolina",
  "diesel",
  "etanol",
  "eletrico",
  "hibrido",
  "gnv",
  "outro",
] as const;

export type VehicleCombustivel = (typeof VEHICLE_COMBUSTIVEIS)[number];

export const VEHICLE_CAMBIOS = [
  "manual",
  "automatico",
  "automatizado",
  "cvt",
  "outro",
] as const;

export type VehicleCambio = (typeof VEHICLE_CAMBIOS)[number];

export const VEHICLE_BATCH_STATUSES = [
  "preview",
  "completed",
  "failed",
  "rolled_back",
] as const;

export type VehicleBatchStatus = (typeof VEHICLE_BATCH_STATUSES)[number];

/**
 * Veículo comercial estruturado e normalizado a partir da planilha.
 */
export interface VehicleParsed {
  linha: number;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: VehicleCombustivel | null;
  cambio: VehicleCambio | null;
  quilometragem: number | null;
  preco_cents: number | null;
  moeda: string;
  status: VehicleStatus;
  opcionais: string[];
  fotos_urls: string[];
  placa_final: string | null;

  // Campos internos restritos (opcionais na planilha)
  placa_completa: string | null;
  chassi: string | null;
  custo_aquisicao_cents: number | null;
  custo_preparacao_cents: number | null;
  observacoes_internas: string | null;
}

/**
 * Registro de veículo da view segura public.vehicles_safe.
 * Exclui colunas confidenciais internas (chassi, placa_completa, custos, observações).
 */
export interface VehicleSafeRow {
  id: string;
  organization_id: string;
  import_batch_id: string | null;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: VehicleCombustivel | null;
  cambio: VehicleCambio | null;
  quilometragem: number | null;
  preco_cents: number | null;
  moeda: string;
  status: VehicleStatus;
  opcionais: string[];
  fotos_urls: string[];
  placa_final: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleRowError {
  linha: number;
  motivo: string;
  campo?: string;
  valorOriginal?: string;
}

export interface VehicleDuplicate {
  linha: number;
  linhaConflitante: number;
  tipo: "chassi" | "placa" | "atributos_comerciais";
  identificador: string;
  mensagem: string;
}

export interface VehiclePreviewReport {
  totalLinhas: number;
  veiculosValidos: VehicleParsed[];
  duplicatas: VehicleDuplicate[];
  erros: VehicleRowError[];
  colunasDetectadas: Record<string, string>;
  colunasIgnoradas: string[];
}

export interface VehicleImportBatchRecord {
  id: string;
  organization_id: string;
  filename: string;
  file_size_bytes: number | null;
  file_hash: string | null;
  total_rows: number;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  status: VehicleBatchStatus;
  errors: unknown[];
  metadata: Record<string, unknown>;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehiclePreviewApiResponse {
  batch_id: string;
  filename: string;
  file_size_bytes: number;
  file_hash: string;
  resumo: {
    total_linhas: number;
    validos_count: number;
    duplicatas_planilha_count: number;
    duplicatas_estoque_count: number;
    erros_count: number;
  };
  colunas_detectadas: Record<string, string>;
  colunas_ignoradas: string[];
  erros: VehicleRowError[];
  duplicatas: Array<{
    linha: number;
    tipo: string;
    identificador_mascarado: string | null;
    mensagem: string;
  }>;
  amostra_veiculos: Array<{
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
  }>;
}

export interface VehicleConfirmApiResponse {
  batch_id: string;
  status: "completed";
  total_rows: number;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  confirmed_at: string;
  idempotency_replayed?: boolean;
}

