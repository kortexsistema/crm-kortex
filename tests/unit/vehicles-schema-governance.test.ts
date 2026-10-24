/**
 * GOVERNANÇA DO SCHEMA DE VEÍCULOS E LOTES DE IMPORTAÇÃO (Subetapa 2.1).
 *
 * Valida a modelagem de dados da migration 0249_vehicles e seu apêndice no baseline:
 * 1. public.vehicles e public.vehicle_import_batches como tabelas próprias (não reutiliza catalog_products).
 * 2. Ausência de default 0 em preco_cents e quilometragem (NULL quando ausentes).
 * 3. RLS habilitada com isolamento de tenant e verificação do nicho 'vehicles'.
 * 4. Proteção de colunas confidenciais:
 *    - grant select em colunas específicas na tabela base para authenticated (omitindo confidenciais).
 *    - view segura public.vehicles_safe com security_invoker = true contendo apenas dados comerciais.
 *    - revogação total de privilégios para anon.
 * 5. Registro correto da migração em MANIFEST.md e no apêndice de baseline.sql.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_PATH = join(ROOT, "supabase", "migrations", "20261023120000_0249_vehicles.sql");
const BASELINE_PATH = join(ROOT, "supabase", "baseline.sql");
const MANIFEST_PATH = join(ROOT, "supabase", "migrations", "MANIFEST.md");

describe("Subetapa 2.1 — Schema de Veículos e Lotes de Importação", () => {
  it("os artefatos da tripla da doutrina existem", () => {
    expect(existsSync(MIGRATION_PATH), "migration 0249_vehicles.sql deve existir").toBe(true);
    expect(existsSync(BASELINE_PATH), "baseline.sql deve existir").toBe(true);
    expect(existsSync(MANIFEST_PATH), "MANIFEST.md deve existir").toBe(true);
  });

  it("a migration 0249 está registrada no MANIFEST.md", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf8");
    expect(manifest).toContain("0249_vehicles");
    expect(manifest).toMatch(/\|\s*`20261023120000`\s*\|\s*`0249_vehicles`\s*\|/);
  });

  it("o apêndice da migration 0249 está presente no baseline.sql de forma idêntica", () => {
    const baseline = readFileSync(BASELINE_PATH, "utf8");
    expect(baseline).toContain("-- 20261023120000_0249_vehicles.sql");
    expect(baseline).toContain("create table if not exists public.vehicle_import_batches");
    expect(baseline).toContain("create table if not exists public.vehicles");
    expect(baseline).toContain("create or replace view public.vehicles_safe");
  });

  it("não reutiliza catalog_products nem toca em tabelas de e-commerce", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).not.toContain("alter table public.catalog_products");
    expect(migration).not.toContain("alter table public.orders");
    expect(migration).toContain("create table if not exists public.vehicles");
  });

  it("preço e quilometragem não possuem default 0 (são anuláveis)", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    // Preço e quilometragem não devem ter 'default 0' na definição DDL
    expect(migration).not.toMatch(/^\s*quilometragem\s+[^,\n]+default\s+0/im);
    expect(migration).not.toMatch(/^\s*preco_cents\s+[^,\n]+default\s+0/im);
    // Mas devem ter checks de não-negatividade quando preenchidos
    expect(migration).toMatch(/quilometragem integer check \(quilometragem is null or quilometragem >= 0\)/);
    expect(migration).toMatch(/preco_cents bigint check \(preco_cents is null or preco_cents >= 0\)/);
  });

  it("garante proteção de colunas confidenciais via grant de colunas e view segura", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    // 1. View segura com security_invoker = true
    expect(migration).toContain("create or replace view public.vehicles_safe");
    expect(migration).toContain("with (security_invoker = true)");

    // 2. A view NÃO deve conter colunas confidenciais
    const viewMatch = migration.match(/create or replace view public\.vehicles_safe[\s\S]+?from public\.vehicles;/i);
    expect(viewMatch, "view vehicles_safe deve ser encontrada").toBeTruthy();
    const viewSql = viewMatch![0];
    expect(viewSql).not.toContain("placa_completa");
    expect(viewSql).not.toContain("chassi");
    expect(viewSql).not.toContain("custo_aquisicao_cents");
    expect(viewSql).not.toContain("custo_preparacao_cents");
    expect(viewSql).not.toContain("observacoes_internas");

    // 3. Grant de SELECT na tabela base para authenticated restringe colunas confidenciais
    expect(migration).toContain("revoke all on public.vehicles from anon, authenticated;");
    const grantMatch = migration.match(/grant select \(([\s\S]+?)\) on public\.vehicles to authenticated;/i);
    expect(grantMatch, "grant select com colunas explícitas para authenticated deve existir").toBeTruthy();
    const grantColumns = grantMatch![1];
    expect(grantColumns).not.toContain("placa_completa");
    expect(grantColumns).not.toContain("chassi");
    expect(grantColumns).not.toContain("custo_aquisicao_cents");
    expect(grantColumns).not.toContain("custo_preparacao_cents");
    expect(grantColumns).not.toContain("observacoes_internas");

    // 4. Anon não tem acesso a nada
    expect(migration).toContain("revoke all on public.vehicles from anon, authenticated;");
    expect(migration).toContain("revoke all on public.vehicles_safe from anon;");
    expect(migration).toContain("revoke all on public.vehicle_import_batches from anon;");
  });

  it("as políticas RLS garantem isolamento de organização e nicho vehicles", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    // RLS ativado nas tabelas
    expect(migration).toContain("alter table public.vehicles enable row level security;");
    expect(migration).toContain("alter table public.vehicle_import_batches enable row level security;");

    // Validação de nicho vehicles na RLS de vehicles
    expect(migration).toContain("o.niche_id = 'vehicles'");
    expect(migration).toContain("public.fn_user_org_ids()");
    expect(migration).toContain("public.fn_role_at_least(organization_id, 'manager')");
    expect(migration).toContain("public.fn_is_platform_admin()");
  });

  it("vehicle_import_batches possui controle de status, totais e idempotência", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain("status in ('preview', 'completed', 'failed', 'rolled_back')");
    expect(migration).toContain("total_rows integer not null default 0");
    expect(migration).toContain("imported_count integer not null default 0");
    expect(migration).toContain("duplicate_count integer not null default 0");
    expect(migration).toContain("error_count integer not null default 0");
    expect(migration).toContain("errors jsonb not null default '[]'::jsonb");
    expect(migration).toContain("confirmed_at timestamptz");
  });

  describe("Subetapa 2.6 — Atomicidade e RPC Transacional (0250)", () => {
    const MIGRATION_0250_PATH = join(ROOT, "supabase", "migrations", "20261024120000_0250_vehicle_import_transactional.sql");

    it("os artefatos da migration 0250 existem e estão registrados", () => {
      expect(existsSync(MIGRATION_0250_PATH), "migration 0250 deve existir").toBe(true);
      const manifest = readFileSync(MANIFEST_PATH, "utf8");
      expect(manifest).toContain("0250_vehicle_import_transactional");

      const baseline = readFileSync(BASELINE_PATH, "utf8");
      expect(baseline).toContain("0250_vehicle_import_transactional");
      expect(baseline).toContain("fn_confirm_vehicle_import");
    });

    it("declara índice único parcial de idempotência", () => {
      const sql0250 = readFileSync(MIGRATION_0250_PATH, "utf8");
      expect(sql0250).toContain("uq_vehicle_import_batches_org_idempotency");
      expect(sql0250).toContain("unique index if not exists uq_vehicle_import_batches_org_idempotency");
      expect(sql0250).toContain("(organization_id, idempotency_key)");
      expect(sql0250).toContain("where idempotency_key is not null");
    });

    it("fn_confirm_vehicle_import possui segurança estrita (security definer, search_path, revogação de anon/authenticated e grant a service_role)", () => {
      const sql0250 = readFileSync(MIGRATION_0250_PATH, "utf8");
      expect(sql0250).toContain("create or replace function public.fn_confirm_vehicle_import");
      expect(sql0250).toContain("security definer");
      expect(sql0250).toContain("set search_path to 'public', 'pg_temp'");
      expect(sql0250).toContain("for update"); // Trava pessimista

      // Defesa contra privilégios expostos (CLAUDE.md item 9)
      expect(sql0250).toContain("revoke execute on function public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)");
      expect(sql0250).toContain("from public, anon, authenticated;");
      expect(sql0250).toContain("grant execute on function public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)");
      expect(sql0250).toContain("to service_role;");
    });
  });
});

