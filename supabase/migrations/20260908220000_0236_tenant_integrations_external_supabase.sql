-- 20260908220000_0236_tenant_integrations_external_supabase.sql

-- Adiciona 'external_supabase' como provider na constraint de tenant_integrations
ALTER TABLE "public"."tenant_integrations" 
  DROP CONSTRAINT "tenant_integrations_provider_check";

ALTER TABLE "public"."tenant_integrations"
  ADD CONSTRAINT "tenant_integrations_provider_check" 
  CHECK ("provider" = ANY (ARRAY['nuvemshop'::text, 'vtex'::text, 'shopify'::text, 'external_supabase'::text]));
