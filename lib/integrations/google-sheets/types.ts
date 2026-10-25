/**
 * Tipos e configurações da integração Google Sheets para sincronização de estoque e catálogo.
 */

export interface GoogleSheetsStoreMetadata {
  sheet_url: string;
  sheet_gid?: string;
  auto_sync?: boolean;
  sync_frequency_hours?: number;
  last_sync_status?: "success" | "error" | "running";
  last_sync_error?: string | null;
  last_sync_products_count?: number;
  last_sync_created_count?: number;
  last_sync_updated_count?: number;
  sync_locked_until?: string | null;
  [key: string]: unknown;
}

export interface GoogleSheetsConfigResponse {
  id: string;
  sheet_url: string;
  sheet_gid: string;
  auto_sync: boolean;
  status: string;
  last_sync_at: string | null;
  last_sync_status: "success" | "error" | "running" | null;
  last_sync_error: string | null;
  last_sync_products_count: number;
  last_sync_created_count: number;
  last_sync_updated_count: number;
}

export interface GoogleSheetsSyncResult {
  total: number;
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}
