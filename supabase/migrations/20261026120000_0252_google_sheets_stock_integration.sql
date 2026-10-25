-- 20261026120000_0252_google_sheets_stock_integration.sql
--
-- Adiciona 'google_sheets' como provider na constraint de tenant_integrations
-- para permitir a sincronização automática de estoque/produtos e base de conhecimento.

ALTER TABLE "public"."tenant_integrations"
  DROP CONSTRAINT IF EXISTS "tenant_integrations_provider_check";

ALTER TABLE "public"."tenant_integrations"
  ADD CONSTRAINT "tenant_integrations_provider_check"
  CHECK ("provider" = ANY (ARRAY[
    'nuvemshop'::text,
    'vtex'::text,
    'shopify'::text,
    'external_supabase'::text,
    'google_sheets'::text
  ]));

NOTIFY pgrst, 'reload schema';
