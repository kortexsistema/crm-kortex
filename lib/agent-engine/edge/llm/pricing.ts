/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo.
 *
 * Fonte: https://docs.claude.com/en/docs/about-claude/pricing (conferida 2026-07);
 * cache write cotado no TTL 1h (2× input) — o TTL adotado pela doutrina de caching
 * (CLAUDE.md regra 15); cache read = 0.1× input.
 *
 * Modelo fora da tabela → custo NULL (desconhecido): mais honesto que inventar 0 —
 * o budget soma coalesce(cost_cents, 0), então modelo sem preço não consome teto;
 * quem habilitar um modelo novo para uma org adiciona a linha de preço aqui.
 */

/** USD por MILHÃO de tokens; match por prefixo longo primeiro (ex: 'gpt-4o-mini' antes de 'gpt-4o'). */
import type { Queryable } from '../../queue/queue';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Cache de preços por prefixo do modelo */
let _agentPricingCache: Array<{ prefix: string; input: number; output: number }> | null = null;
let _agentPricingFetchedAt = 0;
const AGENT_PRICING_TTL_MS = 5 * 60 * 1000;

async function loadAgentPricing(db: Queryable): Promise<Array<{ prefix: string; input: number; output: number }>> {
  const now = Date.now();
  if (_agentPricingCache && now - _agentPricingFetchedAt < AGENT_PRICING_TTL_MS) {
    return _agentPricingCache;
  }
  
  try {
    const { rows } = await db.query<{ model_prefix: string; input_usd_per_mtok: number; output_usd_per_mtok: number }>(
      `SELECT model_prefix, input_usd_per_mtok, output_usd_per_mtok FROM agent_llm_pricing`
    );
    
    // Ordernar por tamanho do prefixo descendente garante que 'gpt-4o-mini' dê match antes de 'gpt-4o'
    const cache = rows
      .map(r => ({
        prefix: r.model_prefix,
        input: Number(r.input_usd_per_mtok),
        output: Number(r.output_usd_per_mtok)
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
 * descontada e cobrada pela tarifa de cache.
 */
export async function costCents(db: Queryable, model: string, usage: TokenUsage): Promise<number | null> {
  // Limpar prefixos de provedores (ex: openai/gpt-4o -> gpt-4o), espaços e maiúsculas
  const normalizedModel = model.trim().toLowerCase().split('/').pop() || '';

  const prices = await loadAgentPricing(db);
  const p = prices.find((item) => normalizedModel.startsWith(item.prefix));

  if (!p) {
    return null;
  }

  // Multiplicadores padrão de cache
  const cacheReadPrice = p.input * 0.1;
  const cacheWritePrice = p.input * 1.25;

  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * cacheReadPrice +
      usage.cacheWriteTokens * cacheWritePrice +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}
