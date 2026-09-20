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
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },

  // Anthropic
  'claude-3-5-haiku': { input: 0.25, output: 1.25 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },

  // Google Gemini
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache.
 */
export function costCents(model: string, usage: TokenUsage): number | null {
  // Limpar prefixos de provedores (ex: openai/gpt-4o -> gpt-4o), espaços e maiúsculas
  const normalizedModel = model.trim().toLowerCase().split('/').pop() || '';

  // Ordernar chaves por comprimento descendente garante que 'gpt-4o-mini' dê match antes de 'gpt-4o'
  const priceKey = Object.keys(USD_PER_MTOK)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => normalizedModel.startsWith(prefix));

  if (priceKey === undefined) {
    return null;
  }
  const p = USD_PER_MTOK[priceKey];
  if (p === undefined) {
    return null; // inalcançável (key veio de Object.keys); satisfaz noUncheckedIndexedAccess
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
