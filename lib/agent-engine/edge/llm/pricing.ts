/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo.
 *
 * Suporta precificação por modelo com taxas dedicadas de cache (cache_read / cache_write)
 * e multiplicadores oficiais por provedor (OpenAI 0.5x leitura / Anthropic 0.1x leitura, 1.25x escrita).
 */

import type { Queryable } from '../../queue/queue';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentPricingRow {
  prefix: string;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  provider: string | null;
}

/** Cache de preços por prefixo do modelo */
let _agentPricingCache: Array<AgentPricingRow> | null = null;
let _agentPricingFetchedAt = 0;
const AGENT_PRICING_TTL_MS = 5 * 60 * 1000;

export async function loadAgentPricing(db: Queryable): Promise<Array<AgentPricingRow>> {
  const now = Date.now();
  if (_agentPricingCache && now - _agentPricingFetchedAt < AGENT_PRICING_TTL_MS) {
    return _agentPricingCache;
  }
  
  try {
    let rows: Array<{
      model_prefix: string;
      input_usd_per_mtok: number | string;
      output_usd_per_mtok: number | string;
      cache_read_usd_per_mtok?: number | string | null;
      cache_write_usd_per_mtok?: number | string | null;
      provider?: string | null;
    }> = [];

    try {
      const res = await db.query<{
        model_prefix: string;
        input_usd_per_mtok: number | string;
        output_usd_per_mtok: number | string;
        cache_read_usd_per_mtok?: number | string | null;
        cache_write_usd_per_mtok?: number | string | null;
        provider?: string | null;
      }>(
        `SELECT model_prefix, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok, provider FROM agent_llm_pricing`
      );
      rows = res.rows;
    } catch {
      // Fallback para tabela anterior à migration 0256 (compatibilidade retroativa)
      const fallbackRes = await db.query<{
        model_prefix: string;
        input_usd_per_mtok: number | string;
        output_usd_per_mtok: number | string;
      }>(
        `SELECT model_prefix, input_usd_per_mtok, output_usd_per_mtok FROM agent_llm_pricing`
      );
      rows = fallbackRes.rows;
    }
    
    // Ordenar por tamanho do prefixo descendente garante que 'gpt-4o-mini' dê match antes de 'gpt-4o'
    const cache: AgentPricingRow[] = rows
      .map(r => ({
        prefix: r.model_prefix,
        input: Number(r.input_usd_per_mtok),
        output: Number(r.output_usd_per_mtok),
        cacheRead: r.cache_read_usd_per_mtok !== null && r.cache_read_usd_per_mtok !== undefined ? Number(r.cache_read_usd_per_mtok) : null,
        cacheWrite: r.cache_write_usd_per_mtok !== null && r.cache_write_usd_per_mtok !== undefined ? Number(r.cache_write_usd_per_mtok) : null,
        provider: r.provider ?? null,
      }))
      .sort((a, b) => b.prefix.length - a.prefix.length);
      
    _agentPricingCache = cache;
    _agentPricingFetchedAt = now;
    return cache;
  } catch (err) {
    // Fallback: se falhar, retorna cache antigo ou array vazio sem lançar
    return _agentPricingCache ?? [];
  }
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache específica do modelo/provedor.
 */
export async function costCents(
  db: Queryable,
  model: string,
  usage: TokenUsage,
  providerOverride?: string,
): Promise<number | null> {
  // Limpar prefixos de provedores (ex: openai/gpt-4o -> gpt-4o), espaços e maiúsculas
  const normalizedModel = model.trim().toLowerCase().split('/').pop() || '';

  const prices = await loadAgentPricing(db);
  const p = prices.find((item) => normalizedModel.startsWith(item.prefix));

  if (!p) {
    return null;
  }

  // Identificar provedor para regras de fallback quando a linha não tiver preços específicos de cache
  const resolvedProvider = (
    providerOverride ||
    p.provider ||
    (normalizedModel.startsWith('claude') ? 'anthropic' : '') ||
    (normalizedModel.startsWith('gpt') || normalizedModel.startsWith('o1') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('text-embedding') ? 'openai' : '') ||
    (normalizedModel.startsWith('gemini') ? 'google' : '') ||
    (normalizedModel.startsWith('deepseek') ? 'deepseek' : '') ||
    'openai'
  ).toLowerCase();

  // Preço de Cache Read:
  // 1. Se explicitamente definido na linha do banco, usa o valor específico do modelo
  // 2. Senão, aplica o multiplicador oficial daquele provedor
  let cacheReadPrice: number;
  if (p.cacheRead !== null && !isNaN(p.cacheRead)) {
    cacheReadPrice = p.cacheRead;
  } else if (resolvedProvider === 'anthropic') {
    cacheReadPrice = p.input * 0.1; // Anthropic prompt cache read = 10%
  } else if (resolvedProvider === 'google') {
    cacheReadPrice = p.input * 0.25; // Google context cache read = 25%
  } else if (resolvedProvider === 'deepseek') {
    cacheReadPrice = p.input * 0.1; // DeepSeek prompt cache read = 10%
  } else {
    // OpenAI e padrão: 50% de desconto oficial sobre o preço de input
    cacheReadPrice = p.input * 0.5;
  }

  // Preço de Cache Write:
  // 1. Se explicitamente definido na linha do banco, usa o valor específico do modelo
  // 2. Senão, aplica a regra do provedor
  let cacheWritePrice: number;
  if (p.cacheWrite !== null && !isNaN(p.cacheWrite)) {
    cacheWritePrice = p.cacheWrite;
  } else if (resolvedProvider === 'anthropic') {
    cacheWritePrice = p.input * 1.25; // Anthropic prompt cache write = 125% (TTL 1h)
  } else {
    // OpenAI e outros: sem sobretaxa de escrita (1.0x input normal)
    cacheWritePrice = p.input * 1.0;
  }

  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * cacheReadPrice +
      usage.cacheWriteTokens * cacheWritePrice +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}

/** Test-only: drop the in-memory pricing cache. */
export function _resetAgentPricingCacheForTests(): void {
  _agentPricingCache = null;
  _agentPricingFetchedAt = 0;
}
