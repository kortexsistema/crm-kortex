-- 20261007190000_0243_supabase_integration_tables_status_mapping.sql

ALTER TABLE "public"."supabase_integration_tables"
ADD COLUMN IF NOT EXISTS "status_mapping" jsonb NOT NULL DEFAULT '{}'::jsonb;
