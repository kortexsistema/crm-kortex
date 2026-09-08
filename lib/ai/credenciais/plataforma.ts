/**
 * CREDENCIAIS DE IA GLOBAIS DA PLATAFORMA (Admin Master / SaaS).
 *
 * Permite que o Superadministrador da Plataforma configure as chaves de API
 * centrais para a instalação inteira em `platform_ai_credentials`.
 *
 * ── Precedência de Resolução ────────────────────────────────────────────────
 * 1. BYOK do Tenant: `ai_provider_credentials` (se o agente apontar para `credential_id` específico)
 * 2. Plataforma (Admin Master): `platform_ai_credentials` (banco de dados, configurado via /admin/ia)
 * 3. Piso de Rollback: Variáveis de ambiente (.env - ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 *
 * ── Segurança e Caching ─────────────────────────────────────────────────────
 * - RLS ligada com zero policies, acessível apenas via `createAdminClient()`.
 * - Cifrada via AES-256-GCM (`lib/crypto/aes_gcm.ts`).
 * - Memo de processo com TTL de 30s no `globalThis` para evitar idas repetidas ao Postgres
 *   a cada requisição de LLM, com invalidação explícita no salvamento pelo /admin.
 */

import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Provider } from "@/lib/ai/provider-validators";

export interface PlatformAiCredentialSafe {
  provider: Provider;
  api_key_last4: string;
  models_available: string[] | null;
  validated_at: string | null;
  validation_error: string | null;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

interface LinhaCredencialPlataforma {
  provider: Provider;
  api_key_encrypted: unknown;
  api_key_iv: unknown;
  api_key_tag: unknown;
  api_key_last4: string;
  models_available: string[] | null;
  validated_at: string | null;
  validation_error: string | null;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

const TTL_MS = 30_000;

declare global {
  // eslint-disable-next-line no-var
  var __memoPlatformAiCredentials: {
    readonly mapa: Map<Provider, { apiKey: string; models: string[]; isActive: boolean }>;
    readonly expiraEm: number;
  } | null | undefined;
}

/** Invalida o cache em memória após alteração via Server Action no /admin. */
export function invalidarCacheCredenciaisPlataforma(): void {
  globalThis.__memoPlatformAiCredentials = null;
}

/**
 * Lista as credenciais configuradas na plataforma sem expor chaves ou dados sensíveis.
 * Consumido pelas telas administrativas do /admin.
 */
export async function listarCredenciaisDaPlataforma(): Promise<PlatformAiCredentialSafe[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("platform_ai_credentials_safe")
      .select("provider, api_key_last4, models_available, validated_at, validation_error, is_active, updated_at, updated_by")
      .order("provider");

    if (error) {
      logger.warn("[platform_ai_credentials] Falha ao listar credenciais da plataforma", {
        codigo: error.code,
        mensagem: error.message,
      });
      return [];
    }

    return (data as PlatformAiCredentialSafe[]) ?? [];
  } catch (err) {
    logger.warn("[platform_ai_credentials] Erro inesperado ao listar credenciais", {
      erro: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Carrega e decifra todas as chaves ativas da plataforma, utilizando cache com TTL de 30s.
 * Nunca lança exceção: em caso de erro, degrada graciosamente para que o piso de rollback (.env) assuma.
 */
async function carregarMapaCredenciaisPlataforma(): Promise<Map<Provider, { apiKey: string; models: string[]; isActive: boolean }>> {
  const memo = globalThis.__memoPlatformAiCredentials;
  if (memo && memo.expiraEm > Date.now()) {
    return memo.mapa;
  }

  const mapa = new Map<Provider, { apiKey: string; models: string[]; isActive: boolean }>();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("platform_ai_credentials")
      .select("provider, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, models_available, validated_at, validation_error, is_active, updated_at, updated_by");

    if (error) {
      logger.warn("[platform_ai_credentials] Tabela inacessível ou sem dados; fallback para .env", {
        codigo: error.code,
      });
    } else if (data) {
      for (const row of data as LinhaCredencialPlataforma[]) {
        try {
          const ciphertext = byteaToBuffer(row.api_key_encrypted);
          const iv = byteaToBuffer(row.api_key_iv);
          const tag = byteaToBuffer(row.api_key_tag);
          const plaintext = decryptKey({ ciphertext, iv, tag });

          mapa.set(row.provider, {
            apiKey: plaintext,
            models: row.models_available ?? [],
            isActive: row.is_active,
          });
        } catch (decErr) {
          logger.warn("[platform_ai_credentials] Falha ao decifrar credencial do provedor", {
            provider: row.provider,
            erro: decErr instanceof Error ? decErr.message : String(decErr),
          });
        }
      }
    }
  } catch (err) {
    logger.warn("[platform_ai_credentials] Erro ao buscar credenciais da plataforma", {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  globalThis.__memoPlatformAiCredentials = {
    mapa,
    expiraEm: Date.now() + TTL_MS,
  };

  return mapa;
}

/**
 * Obtém a credencial ativa e decifrada de um provedor específico configurado na plataforma.
 */
export async function obterCredencialDecifradaDaPlataforma(
  provider: Provider,
): Promise<{ apiKey: string; models: string[] } | null> {
  const mapa = await carregarMapaCredenciaisPlataforma();
  const entry = mapa.get(provider);
  if (!entry || !entry.isActive || !entry.apiKey) {
    return null;
  }
  return { apiKey: entry.apiKey, models: entry.models };
}

/**
 * Verifica se a plataforma possui ao menos um provedor de IA ativo e configurado.
 */
export async function plataformaTemIaConfigurada(): Promise<boolean> {
  const mapa = await carregarMapaCredenciaisPlataforma();
  for (const [, entry] of mapa) {
    if (entry.isActive && entry.apiKey) {
      return true;
    }
  }
  return false;
}
