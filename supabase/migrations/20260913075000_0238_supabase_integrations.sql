-- 20260913075000_0238_supabase_integrations.sql

CREATE TABLE "public"."supabase_integration_tables" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "organization_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "table_name" text NOT NULL,
  "filter_column" text NOT NULL,
  "return_columns" text[] NOT NULL,
  "instruction" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  "updated_at" timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  
  CONSTRAINT "supabase_integration_tables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supabase_integration_tables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "supabase_integration_tables_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."tenant_integrations"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."supabase_integration_tables" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supabase_integration_tables_isolation_policy" ON "public"."supabase_integration_tables"
  FOR ALL TO "authenticated"
  USING (
    "organization_id" = (current_setting('app.current_organization_id'::text, true))::uuid
    OR 
    (current_setting('app.is_service_role'::text, true) = 'true')
  )
  WITH CHECK (
    "organization_id" = (current_setting('app.current_organization_id'::text, true))::uuid
    OR 
    (current_setting('app.is_service_role'::text, true) = 'true')
  );

CREATE TRIGGER handle_updated_at_supabase_integration_tables
  BEFORE UPDATE ON "public"."supabase_integration_tables"
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

-- Não vamos dar GRANT SELECT para public nem anon, apenas para authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."supabase_integration_tables" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."supabase_integration_tables" TO "service_role";
