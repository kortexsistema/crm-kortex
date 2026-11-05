-- Migration: 0256_expand_agent_llm_pricing
-- Purpose: Expansão de modelos e tarifas exatas de cache por modelo/provedor (OpenAI 0.5x cache read, Anthropic 0.1x/1.25x)

ALTER TABLE public.agent_llm_pricing
    ADD COLUMN IF NOT EXISTS cache_read_usd_per_mtok numeric(10,4),
    ADD COLUMN IF NOT EXISTS cache_write_usd_per_mtok numeric(10,4),
    ADD COLUMN IF NOT EXISTS provider text;

-- Atualizar modelos existentes e inserir novos com precificação oficial por milhão de tokens (USD)
INSERT INTO public.agent_llm_pricing 
(model_prefix, provider, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok)
VALUES
    -- OpenAI Chat / Raciocínio (Cache read = 50% de desconto oficial; Cache write = 1.0x input normal)
    ('gpt-6.1-terra', 'openai', 1.00, 2.00, 0.50, 1.00),
    ('gpt-5.6-terra', 'openai', 1.00, 2.00, 0.50, 1.00),
    ('gpt-4o-mini', 'openai', 0.15, 0.60, 0.075, 0.15),
    ('gpt-4o', 'openai', 2.50, 10.00, 1.25, 2.50),
    ('o1-mini', 'openai', 1.10, 4.40, 0.55, 1.10),
    ('o3-mini', 'openai', 1.10, 4.40, 0.55, 1.10),
    ('gpt-4-turbo', 'openai', 10.00, 30.00, 5.00, 10.00),
    ('gpt-3.5-turbo', 'openai', 0.50, 1.50, 0.50, 0.50),
    -- OpenAI Embeddings (Input apenas)
    ('text-embedding-3-small', 'openai', 0.02, 0.00, 0.00, 0.00),
    ('text-embedding-3-large', 'openai', 0.13, 0.00, 0.00, 0.00),
    
    -- Anthropic (Prompt cache read = 10%, Prompt cache write = 125% com TTL 1h)
    ('claude-3-5-haiku', 'anthropic', 0.25, 1.25, 0.025, 0.3125),
    ('claude-haiku-4-5', 'anthropic', 0.25, 1.25, 0.025, 0.3125),
    ('claude-3-5-sonnet', 'anthropic', 3.00, 15.00, 0.30, 3.75),
    ('claude-3-opus', 'anthropic', 15.00, 75.00, 1.50, 18.75),
    
    -- Google Gemini (Context caching read = 25%)
    ('gemini-1.5-flash', 'google', 0.075, 0.30, 0.01875, 0.075),
    ('gemini-1.5-pro', 'google', 1.25, 5.00, 0.3125, 1.25),
    
    -- DeepSeek (OpenRouter)
    ('deepseek-chat', 'deepseek', 0.14, 0.28, 0.014, 0.14),
    ('deepseek-coder', 'deepseek', 0.14, 0.28, 0.014, 0.14),
    
    -- Meta Llama (OpenRouter)
    ('llama-3.1-8b', 'meta', 0.05, 0.05, 0.05, 0.05),
    ('llama-3.1-70b', 'meta', 0.40, 0.40, 0.40, 0.40)
ON CONFLICT (model_prefix) DO UPDATE SET
    provider = EXCLUDED.provider,
    input_usd_per_mtok = EXCLUDED.input_usd_per_mtok,
    output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
    cache_read_usd_per_mtok = EXCLUDED.cache_read_usd_per_mtok,
    cache_write_usd_per_mtok = EXCLUDED.cache_write_usd_per_mtok,
    updated_at = now();

