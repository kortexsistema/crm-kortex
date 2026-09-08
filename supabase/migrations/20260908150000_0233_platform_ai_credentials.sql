-- =============================================================================
-- Migration 0233: Credenciais de IA globais da plataforma (Admin Master / SaaS)
-- =============================================================================
-- Permite que o Superadministrador da Plataforma (Admin Master) configure as
-- chaves de API dos provedores de IA (Anthropic, OpenAI, Google, OpenRouter)
-- centralizadamente no painel /admin, tornando-as o padrão nativo para todos os
-- tenants sem exigir que cada assinante cadastre chaves próprias (BYOK).
--
-- Mesma disciplina de segurança de `platform_google_oauth` (0201) e `platform_branding` (0155):
-- RLS ligada com zero policies, grants revogados de anon/authenticated. Apenas service_role
-- (server-side via createAdminClient()) tem acesso de leitura e escrita.
-- =============================================================================

create table if not exists public.platform_ai_credentials (
  provider text primary key check (provider in ('anthropic', 'openai', 'google', 'openrouter')),

  -- API key cifrada (AES-256-GCM via lib/crypto/aes_gcm)
  api_key_encrypted bytea not null,
  api_key_iv bytea not null,
  api_key_tag bytea not null,
  api_key_last4 text not null,

  models_available text[],
  validated_at timestamptz,
  validation_error text,

  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.platform_ai_credentials is
  'Credenciais de IA globais da instalação configuradas pelo Admin Master. Server-side only: RLS ligada sem policies e grants revogados de anon/authenticated.';

alter table public.platform_ai_credentials enable row level security;

revoke all on public.platform_ai_credentials from anon, authenticated;
grant select, insert, update, delete on public.platform_ai_credentials to service_role;

-- View segura: SELECT sem campos cifrados para consumo do painel /admin
drop view if exists public.platform_ai_credentials_safe;
create view public.platform_ai_credentials_safe
  with (security_invoker = false)
  as
  select provider, api_key_last4, models_available, validated_at,
         validation_error, is_active, updated_at, updated_by
  from public.platform_ai_credentials;

revoke all on public.platform_ai_credentials_safe from anon, authenticated;
grant select on public.platform_ai_credentials_safe to service_role;
