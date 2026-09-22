-- Migration 0240: SaaS Controls (Subscription & AI Budget Limits)
-- Adiciona controles de limites SaaS e valores de assinatura diretamente na tabela organizations.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS saas_subscription_value_cents bigint,
  ADD COLUMN IF NOT EXISTS saas_ai_limit_cents bigint,
  ADD COLUMN IF NOT EXISTS saas_enforcement_mode text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_saas_enforcement_mode_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_saas_enforcement_mode_check
      CHECK (saas_enforcement_mode IN ('off', 'avisar', 'bloquear'));
  END IF;
END $$;
