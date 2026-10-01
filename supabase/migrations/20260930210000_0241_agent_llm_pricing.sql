-- Migration: 0241_agent_llm_pricing
-- Purpose: Create dynamic pricing table for agent engine LLM calls with efficient prefix matching

CREATE TABLE IF NOT EXISTS public.agent_llm_pricing (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    model_prefix text NOT NULL UNIQUE,
    input_usd_per_mtok numeric(10,4) NOT NULL,
    output_usd_per_mtok numeric(10,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- RLS
ALTER TABLE public.agent_llm_pricing ENABLE ROW LEVEL SECURITY;

-- Only service role and platform admins can write, everyone can read (or just service role)
CREATE POLICY "agent_llm_pricing_select_all" ON public.agent_llm_pricing
    FOR SELECT USING (true);

-- Populate base prices (USD per 1M tokens)
INSERT INTO public.agent_llm_pricing (model_prefix, input_usd_per_mtok, output_usd_per_mtok) VALUES
    -- OpenAI
    ('gpt-5.6-terra', 1.00, 2.00),
    ('gpt-4o-mini', 0.15, 0.60),
    ('gpt-4o', 2.50, 10.00),
    -- Anthropic
    ('claude-3-5-haiku', 0.25, 1.25),
    ('claude-haiku-4-5', 0.25, 1.25),
    ('claude-3-5-sonnet', 3.00, 15.00),
    ('claude-3-opus', 15.00, 75.00),
    -- Google Gemini
    ('gemini-1.5-flash', 0.075, 0.30),
    ('gemini-1.5-pro', 1.25, 5.00),
    -- DeepSeek (OpenRouter)
    ('deepseek-chat', 0.14, 0.28),
    ('deepseek-coder', 0.14, 0.28),
    -- Meta Llama (OpenRouter)
    ('llama-3.1-8b', 0.05, 0.05),
    ('llama-3.1-70b', 0.40, 0.40)
ON CONFLICT (model_prefix) DO UPDATE SET
    input_usd_per_mtok = EXCLUDED.input_usd_per_mtok,
    output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
    updated_at = now();
