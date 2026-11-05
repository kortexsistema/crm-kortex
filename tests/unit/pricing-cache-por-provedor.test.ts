/**
 * Testes unitários da fórmula de precificação por provedor e modelo.
 *
 * PROBLEMA CORRIGIDO: a fórmula anterior aplicava os multiplicadores de cache
 * da Anthropic (cacheRead = 0.1×, cacheWrite = 1.25×) universalmente, incluindo
 * para OpenAI, que usa regras diferentes:
 *
 *   - OpenAI cache read  = 0.5× input (50% de desconto, não 90%)
 *   - OpenAI cache write = 1.0× input (preço normal, sem sobretaxa)
 *   - Anthropic cache read  = 0.1× input (90% de desconto)
 *   - Anthropic cache write = 1.25× input (sobretaxa de 25% — TTL 1h)
 *
 * Para modelos com preços exatos de cache definidos na tabela
 * (cache_read_usd_per_mtok / cache_write_usd_per_mtok), esses valores têm
 * precedência sobre qualquer multiplicador genérico.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { Queryable } from '@/lib/agent-engine/queue/queue';
import { costCents, _resetAgentPricingCacheForTests } from '@/lib/agent-engine/edge/llm/pricing';

// ─── Fábrica de db fake ────────────────────────────────────────────────────────

type PricingRow = {
  model_prefix: string;
  provider: string | null;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_read_usd_per_mtok: number | null;
  cache_write_usd_per_mtok: number | null;
};

/** Retorna um objeto compatível com Queryable que responde às queries de pricing. */
function fakeDb(rows: PricingRow[]): Queryable {
  return {
    query: async <R>(sql: string): Promise<{ rows: R[]; rowCount: number; command: string; oid: number; fields: [] }> => {
      if (sql.includes('cache_read_usd_per_mtok')) {
        return { rows: rows as unknown as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
      }
      // fallback query sem colunas de cache
      const fallback = rows.map(r => ({
        model_prefix: r.model_prefix,
        input_usd_per_mtok: r.input_usd_per_mtok,
        output_usd_per_mtok: r.output_usd_per_mtok,
      }));
      return { rows: fallback as unknown as R[], rowCount: fallback.length, command: 'SELECT', oid: 0, fields: [] };
    }
  };
}

function zeroUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

// ─── Helpers de Pricing Rows ───────────────────────────────────────────────────

const GPT4O_MINI: PricingRow = {
  model_prefix: 'gpt-4o-mini',
  provider: 'openai',
  input_usd_per_mtok: 0.15,
  output_usd_per_mtok: 0.60,
  cache_read_usd_per_mtok: 0.075,   // $0.075/1M (OpenAI oficial)
  cache_write_usd_per_mtok: 0.15,   // $0.15/1M (mesmo que input)
};

const GPT4O: PricingRow = {
  model_prefix: 'gpt-4o',
  provider: 'openai',
  input_usd_per_mtok: 2.50,
  output_usd_per_mtok: 10.00,
  cache_read_usd_per_mtok: 1.25,    // $1.25/1M (OpenAI oficial: 50% de 2.50)
  cache_write_usd_per_mtok: 2.50,   // $2.50/1M (mesmo que input)
};

const GPT5_TERRA: PricingRow = {
  model_prefix: 'gpt-5.6-terra',
  provider: 'openai',
  input_usd_per_mtok: 1.00,
  output_usd_per_mtok: 2.00,
  cache_read_usd_per_mtok: 0.50,    // $0.50/1M (OpenAI oficial: 50% de 1.00)
  cache_write_usd_per_mtok: 1.00,   // $1.00/1M (mesmo que input)
};

const CLAUDE_SONNET: PricingRow = {
  model_prefix: 'claude-3-5-sonnet',
  provider: 'anthropic',
  input_usd_per_mtok: 3.00,
  output_usd_per_mtok: 15.00,
  cache_read_usd_per_mtok: 0.30,    // $0.30/1M (Anthropic: 10% de 3.00)
  cache_write_usd_per_mtok: 3.75,   // $3.75/1M (Anthropic: 125% de 3.00)
};

const CLAUDE_HAIKU: PricingRow = {
  model_prefix: 'claude-3-5-haiku',
  provider: 'anthropic',
  input_usd_per_mtok: 0.25,
  output_usd_per_mtok: 1.25,
  cache_read_usd_per_mtok: 0.025,   // $0.025/1M (Anthropic: 10% de 0.25)
  cache_write_usd_per_mtok: 0.3125, // $0.3125/1M (Anthropic: 125% de 0.25)
};

const EMBEDDING_SMALL: PricingRow = {
  model_prefix: 'text-embedding-3-small',
  provider: 'openai',
  input_usd_per_mtok: 0.02,
  output_usd_per_mtok: 0.00,
  cache_read_usd_per_mtok: 0.00,
  cache_write_usd_per_mtok: 0.00,
};

// ─── Testes ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetAgentPricingCacheForTests();
});

describe('costCents — modelo não cadastrado', () => {
  it('retorna null quando o modelo não existe na tabela', async () => {
    const db = fakeDb([GPT4O_MINI]);
    const result = await costCents(db, 'claude-sonnet-4-5', zeroUsage());
    expect(result).toBeNull();
  });

  it('retorna null para string vazia', async () => {
    const db = fakeDb([GPT4O_MINI]);
    const result = await costCents(db, '', zeroUsage());
    expect(result).toBeNull();
  });
});

describe('costCents — input e output sem cache', () => {
  it('gpt-4o-mini — 1M input + 500k output sem cache', async () => {
    const db = fakeDb([GPT4O_MINI]);
    // input: 1M × $0.15 = $0.15 → 15 cents
    // output: 500k × $0.60 / 1M = $0.30 → 30 cents
    // total: 45 cents
    const result = await costCents(
      db,
      'gpt-4o-mini',
      { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(45, 5);
  });

  it('gpt-4o — 1M input + 1M output sem cache', async () => {
    const db = fakeDb([GPT4O_MINI, GPT4O]);
    // input: 1M × $2.50 = $2.50 → 250 cents
    // output: 1M × $10.00 = $10.00 → 1000 cents
    // total: 1250 cents
    const result = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(1250, 5);
  });
});

describe('costCents — OpenAI: cache read a 0.5× input (NÃO 0.1×)', () => {
  it('gpt-4o-mini — 1M tokens em cache read deve custar 50% do preço de input', async () => {
    const db = fakeDb([GPT4O_MINI]);
    // 1M cacheRead × $0.075/1M = $0.075 → 7.5 cents
    const result = await costCents(
      db,
      'gpt-4o-mini',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(7.5, 5);
  });

  it('gpt-5.6-terra — 1M tokens em cache read = $0.50/1M (50% de $1.00)', async () => {
    const db = fakeDb([GPT5_TERRA]);
    // 1M cacheRead × $0.50/1M = $0.50 → 50 cents
    const result = await costCents(
      db,
      'gpt-5.6-terra',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(50, 5);
  });

  it('gpt-4o — cache read NÃO usa multiplicador Anthropic de 0.1×', async () => {
    const db = fakeDb([GPT4O_MINI, GPT4O]);
    // Se usasse 0.1×: 1M × $2.50 × 0.1 / 1M = $0.25 → 25 cents (ERRADO)
    // Correto com preço exato: 1M × $1.25/1M = $1.25 → 125 cents
    const result = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    expect(result!).not.toBeCloseTo(25, 2);   // Não deve ser o valor Anthropic
    expect(result!).toBeCloseTo(125, 5);       // Deve ser o valor correto da OpenAI
  });

  it('gpt-4o — cache write usa 1.0× input (sem sobretaxa)', async () => {
    const db = fakeDb([GPT4O_MINI, GPT4O]);
    // 1M cacheWrite × $2.50/1M = $2.50 → 250 cents
    const result = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
    );
    expect(result!).toBeCloseTo(250, 5);
  });
});

describe('costCents — Anthropic: cache read a 0.1× e cache write a 1.25×', () => {
  it('claude-3-5-sonnet — cache read = $0.30/1M (10% de $3.00)', async () => {
    const db = fakeDb([CLAUDE_SONNET]);
    // 1M cacheRead × $0.30/1M = $0.30 → 30 cents
    const result = await costCents(
      db,
      'claude-3-5-sonnet',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(30, 5);
  });

  it('claude-3-5-sonnet — cache write = $3.75/1M (125% de $3.00)', async () => {
    const db = fakeDb([CLAUDE_SONNET]);
    // 1M cacheWrite × $3.75/1M = $3.75 → 375 cents
    const result = await costCents(
      db,
      'claude-3-5-sonnet',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
    );
    expect(result!).toBeCloseTo(375, 5);
  });

  it('claude-3-5-haiku — cache read = $0.025/1M (10% de $0.25)', async () => {
    const db = fakeDb([CLAUDE_HAIKU]);
    // 1M cacheRead × $0.025/1M = $0.025 → 2.5 cents
    const result = await costCents(
      db,
      'claude-3-5-haiku',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(2.5, 5);
  });

  it('claude-3-5-haiku — cache write = $0.3125/1M (125% de $0.25)', async () => {
    const db = fakeDb([CLAUDE_HAIKU]);
    // 1M cacheWrite × $0.3125/1M = $0.3125 → 31.25 cents
    const result = await costCents(
      db,
      'claude-3-5-haiku',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
    );
    expect(result!).toBeCloseTo(31.25, 5);
  });

  it('Anthropic cache write NÃO é gratuito como no OpenAI', async () => {
    const db = fakeDb([CLAUDE_SONNET]);
    const withCache = await costCents(
      db,
      'claude-3-5-sonnet',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
    );
    const withNormalInput = await costCents(
      db,
      'claude-3-5-sonnet',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    // Cache write deve ser mais caro que input normal
    expect(withCache!).toBeGreaterThan(withNormalInput!);
  });
});

describe('costCents — comparativo OpenAI × Anthropic: mesma quantidade de cache', () => {
  it('gap correto: gpt-4o cache read deve custar 5× mais que se usasse regra Anthropic', async () => {
    const db = fakeDb([GPT4O_MINI, GPT4O]);
    const corretaOpenAI = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    // Correto (OpenAI 0.5×): 1M × $1.25/1M = 125 cents
    // Errado (Anthropic 0.1×): 1M × $0.25/1M = 25 cents
    // Ratio: 125 / 25 = 5×
    expect(corretaOpenAI!).toBeCloseTo(125, 5);
  });
});

describe('costCents — prefixo correto com múltiplos modelos', () => {
  it('gpt-4o-mini dá match antes de gpt-4o', async () => {
    const db = fakeDb([GPT4O_MINI, GPT4O]);
    const mini = await costCents(
      db,
      'gpt-4o-mini',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    const standard = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    // mini ($0.15) deve ser mais barato que gpt-4o ($2.50)
    expect(mini!).toBeLessThan(standard!);
    expect(mini!).toBeCloseTo(15, 5);
    expect(standard!).toBeCloseTo(250, 5);
  });

  it('modelo com prefixo "openai/" é normalizado antes do match', async () => {
    const db = fakeDb([GPT5_TERRA]);
    const comPrefixo = await costCents(
      db,
      'openai/gpt-5.6-terra',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    const semPrefixo = await costCents(
      db,
      'gpt-5.6-terra',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    expect(comPrefixo!).toBeCloseTo(semPrefixo!, 10);
  });
});

describe('costCents — embeddings', () => {
  it('text-embedding-3-small — 10M tokens = $0.20 → 20 cents', async () => {
    const db = fakeDb([EMBEDDING_SMALL]);
    // 10M tokens × $0.02/1M = $0.20 → 20 cents
    const result = await costCents(
      db,
      'text-embedding-3-small',
      { inputTokens: 10_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    expect(result!).toBeCloseTo(20, 5);
  });
});

describe('costCents — fallback: tabela sem colunas de cache (retrocompatibilidade)', () => {
  it('OpenAI sem preço de cache na linha usa fallback 0.5×', async () => {
    const db: Queryable = {
      query: async <R>(_sql: string): Promise<{ rows: R[]; rowCount: number; command: string; oid: number; fields: [] }> => {
        if (_sql.includes('cache_read_usd_per_mtok')) {
          throw new Error('coluna não existe'); // Tabela antiga
        }
        const rows = [{
          model_prefix: 'gpt-4o',
          input_usd_per_mtok: 2.50,
          output_usd_per_mtok: 10.00,
        }];
        return { rows: rows as unknown as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
      }
    };
    // Fallback sem colunas de cache: OpenAI usa 0.5× input = $1.25/1M
    const result = await costCents(
      db,
      'gpt-4o',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    // Sem preços explícitos na linha, deriva-se pelo provider implícito do prefixo gpt-4o → openai → 0.5×
    // 1M × $2.50 × 0.5 / 1M = $1.25 → 125 cents
    expect(result!).toBeCloseTo(125, 5);
  });

  it('Anthropic sem preço de cache na linha usa fallback 0.1× leitura', async () => {
    const db: Queryable = {
      query: async <R>(_sql: string): Promise<{ rows: R[]; rowCount: number; command: string; oid: number; fields: [] }> => {
        if (_sql.includes('cache_read_usd_per_mtok')) {
          throw new Error('coluna não existe');
        }
        const rows = [{
          model_prefix: 'claude-3-5-sonnet',
          input_usd_per_mtok: 3.00,
          output_usd_per_mtok: 15.00,
        }];
        return { rows: rows as unknown as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
      }
    };
    // Fallback para Anthropic: 0.1× input = $0.30/1M
    const result = await costCents(
      db,
      'claude-3-5-sonnet',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    );
    // 1M × $3.00 × 0.1 / 1M = $0.30 → 30 cents
    expect(result!).toBeCloseTo(30, 5);
  });
});

describe('costCents — cálculo misto (input + output + cache)', () => {
  it('gpt-4o-mini — turno realista: 5k input com 1k cached + 300 output', async () => {
    const db = fakeDb([GPT4O_MINI]);
    const usage = {
      inputTokens: 5000,
      outputTokens: 300,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
    };
    // noCacheInput = 5000 - 1000 = 4000
    // 4000 × $0.15/1M = $0.0006 → 0.06 cents
    // 1000 cacheRead × $0.075/1M = $0.000075 → 0.0075 cents
    // 300 × $0.60/1M = $0.00018 → 0.018 cents
    // total ≈ 0.0855 cents → arredondado para 1 cent (Math.ceil)
    const result = await costCents(db, 'gpt-4o-mini', usage);
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThan(0.5); // Muito pequeno em valor absoluto
  });
});
