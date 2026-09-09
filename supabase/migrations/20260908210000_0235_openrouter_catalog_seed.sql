-- =============================================================================
-- Migration 0235: Catálogo inicial curado e modelos gratuitos da OpenRouter
-- =============================================================================
-- O catálogo da OpenRouter não possuía semente nas migrations anteriores e
-- dependia unicamente do cron diário das 04:15 da madrugada. Em clones novos
-- e ambientes frescos, o seletor de modelos exibia "Nenhum modelo disponível".
--
-- Esta migration:
-- 1. Semeia os modelos carro-chefe da OpenRouter (Anthropic Claude, OpenAI GPT,
--    Google Gemini, Meta Llama, DeepSeek e Qwen) com suporte a ferramentas.
-- 2. Semeia os principais modelos gratuitos (:free) para testes imediatos.
-- 3. Define 'meta-llama/llama-3.3-70b-instruct' como padrão (is_default_for_provider).
-- =============================================================================

insert into public.ai_models (
  provider,
  model_id,
  display_name,
  description,
  context_window,
  input_price_per_million_cents,
  output_price_per_million_cents,
  supports_tools,
  supports_vision,
  is_default_for_provider,
  source,
  synced_at
) values
  -- Carros-chefe Open Source & Especialistas
  ('openrouter', 'meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B Instruct', 'Modelo aberto de alta performance da Meta, excelente para ferramentas.', 131072, 12, 30, true, false, false, 'openrouter', now()),
  ('openrouter', 'meta-llama/llama-3.1-405b-instruct', 'Llama 3.1 405B Instruct', 'O maior e mais potente modelo aberto da Meta.', 131072, 80, 80, true, false, false, 'openrouter', now()),
  ('openrouter', 'deepseek/deepseek-chat', 'DeepSeek V3 (Chat)', 'Modelo de uso geral com custo ultrabaixo e altíssima capacidade.', 65536, 14, 28, true, false, false, 'openrouter', now()),
  ('openrouter', 'deepseek/deepseek-r1', 'DeepSeek R1', 'Modelo líder em raciocínio lógico e cadeia de pensamento (CoT).', 65536, 55, 219, true, false, false, 'openrouter', now()),
  ('openrouter', 'qwen/qwen-2.5-72b-instruct', 'Qwen 2.5 72B Instruct', 'Modelo multilíngue de alta capacidade da Alibaba Cloud.', 131072, 23, 40, true, false, false, 'openrouter', now()),
  ('openrouter', 'mistralai/mistral-large', 'Mistral Large', 'Modelo topo de linha da Mistral AI para tarefas complexas.', 131072, 200, 600, true, false, false, 'openrouter', now()),

  -- Anthropic Claude via OpenRouter
  ('openrouter', 'anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet (OpenRouter)', 'Modelo de referência para conversação natural, raciocínio e visão.', 200000, 300, 1500, true, true, false, 'openrouter', now()),
  ('openrouter', 'anthropic/claude-3-haiku', 'Claude 3 Haiku (OpenRouter)', 'Rápido e leve para respostas diretas no WhatsApp.', 200000, 25, 125, true, true, false, 'openrouter', now()),
  ('openrouter', 'anthropic/claude-3.5-haiku', 'Claude 3.5 Haiku (OpenRouter)', 'Geração aprimorada de alta velocidade e precisão.', 200000, 80, 400, true, false, false, 'openrouter', now()),
  ('openrouter', 'anthropic/claude-3-opus', 'Claude 3 Opus (OpenRouter)', 'Máxima capacidade de escrita e compreensão profunda.', 200000, 1500, 7500, true, true, false, 'openrouter', now()),

  -- OpenAI GPT via OpenRouter
  ('openrouter', 'openai/gpt-4o', 'GPT-4o (OpenRouter)', 'Modelo multimodal inteligente e veloz da OpenAI.', 128000, 250, 1000, true, true, false, 'openrouter', now()),
  ('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini (OpenRouter)', 'Versão econômica e rápida para triagem e qualificação.', 128000, 15, 60, true, true, false, 'openrouter', now()),
  ('openrouter', 'openai/gpt-4-turbo', 'GPT-4 Turbo (OpenRouter)', 'Capacidade robusta de instrução com janela de 128k.', 128000, 1000, 3000, true, true, false, 'openrouter', now()),
  ('openrouter', 'openai/o1-preview', 'o1 Preview (OpenRouter)', 'Raciocínio deliberativo para problemas matemáticos e estruturados.', 128000, 1500, 6000, true, false, false, 'openrouter', now()),
  ('openrouter', 'openai/o1-mini', 'o1 Mini (OpenRouter)', 'Raciocínio veloz e eficiente da OpenAI.', 128000, 300, 1200, true, false, false, 'openrouter', now()),

  -- Google Gemini via OpenRouter
  ('openrouter', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash (OpenRouter)', 'Modelo ultrarrápido com janela de 1 milhão de tokens.', 1048576, 15, 60, true, true, false, 'openrouter', now()),
  ('openrouter', 'google/gemini-2.5-pro', 'Gemini 2.5 Pro (OpenRouter)', 'Alta profundidade analítica com contexto massivo.', 1048576, 125, 500, true, true, false, 'openrouter', now()),
  ('openrouter', 'google/gemini-flash-1.5', 'Gemini 1.5 Flash (OpenRouter)', 'Custo-benefício otimizado para operações contínuas.', 1048576, 8, 30, true, true, false, 'openrouter', now()),

  -- Modelos Gratuitos (:free) para testes
  ('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B Instruct (Grátis)', 'Versão gratuita para testes de chamadas de ferramentas e prompts.', 131072, 0, 0, true, false, false, 'openrouter', now()),
  ('openrouter', 'deepseek/deepseek-r1:free', 'DeepSeek R1 (Grátis)', 'Versão gratuita para testes de raciocínio profundo.', 65536, 0, 0, true, false, false, 'openrouter', now()),
  ('openrouter', 'deepseek/deepseek-chat:free', 'DeepSeek V3 (Grátis)', 'Versão gratuita para testes de conversação geral.', 65536, 0, 0, true, false, false, 'openrouter', now()),
  ('openrouter', 'google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash Exp (Grátis)', 'Versão experimental gratuita com suporte a visão e áudio.', 1048576, 0, 0, true, true, false, 'openrouter', now()),
  ('openrouter', 'qwen/qwen-2.5-72b-instruct:free', 'Qwen 2.5 72B Instruct (Grátis)', 'Versão gratuita para testes do modelo Qwen.', 131072, 0, 0, true, false, false, 'openrouter', now()),
  ('openrouter', 'meta-llama/llama-3.1-8b-instruct:free', 'Llama 3.1 8B Instruct (Grátis)', 'Versão leve gratuita para testes rápidos.', 131072, 0, 0, true, false, false, 'openrouter', now())
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = coalesce(excluded.description, public.ai_models.description),
  context_window = coalesce(excluded.context_window, public.ai_models.context_window),
  input_price_per_million_cents = coalesce(excluded.input_price_per_million_cents, public.ai_models.input_price_per_million_cents),
  output_price_per_million_cents = coalesce(excluded.output_price_per_million_cents, public.ai_models.output_price_per_million_cents),
  supports_tools = excluded.supports_tools,
  supports_vision = excluded.supports_vision,
  source = excluded.source,
  synced_at = excluded.synced_at,
  deprecated_at = null;

-- Definir modelo padrão garantindo o índice unique ai_models_one_default_per_provider
update public.ai_models set is_default_for_provider = false
 where provider = 'openrouter' and is_default_for_provider;

update public.ai_models set is_default_for_provider = true
 where provider = 'openrouter' and model_id = 'meta-llama/llama-3.3-70b-instruct';
