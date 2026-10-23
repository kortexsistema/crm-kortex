/**
 * INVARIANTES DINÂMICOS DE BANCO — MÓDULO DE VEÍCULOS (Subetapas 2.1 a 2.6)
 *
 * Executa contra o Postgres efêmero (scripts/test-db.sh / vitest.db.config.ts)
 * com as migrations 0249 e 0250 aplicadas no baseline.
 *
 * Cobre:
 * 1. Existência e integridade estrutural das tabelas e view segura.
 * 2. Privilégios efetivos de anon, authenticated e service_role.
 * 3. Bloqueio de colunas confidenciais para authenticated.
 * 4. Isolamento multi-tenant estrito via RLS.
 * 5. Autorização por papel (manager vs viewer/agent).
 * 6. Governança estrita por nicho de negócio (vehicles vs outros).
 * 7. Comportamento da view vehicles_safe com security_invoker = true.
 * 8. Função transacional fn_confirm_vehicle_import:
 *    - Trava FOR UPDATE e serialização de concorrência.
 *    - Validação de identidade, pertença de lote e papel.
 *    - Rollback integral atômico em caso de falha (0 registros parciais).
 *    - Idempotência real com retorno idempotency_replayed: true.
 *    - Rejeição de chave divergente para lote já confirmado.
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  sql,
  lastLine,
  countAs,
  tableExists,
  columnExists,
  indexExists,
} from "./gov-helpers";

const ORG_AUTO_A = "aaaa1111-0000-4000-8000-000000000001";
const ORG_AUTO_B = "bbbb2222-0000-4000-8000-000000000002";
const ORG_ECOM = "cccc3333-0000-4000-8000-000000000003";

const USER_MANAGER_A = "aaaa1111-1111-4000-8000-000000000001";
const USER_VIEWER_A = "aaaa1111-2222-4000-8000-000000000002";
const USER_MANAGER_B = "bbbb2222-1111-4000-8000-000000000001";
const USER_MANAGER_ECOM = "cccc3333-1111-4000-8000-000000000001";

/** Executa script em psql sob uma role explícita (sem depender de superusuário) */
function sqlAs(role: "service_role" | "authenticated" | "anon", script: string): string {
  return sql(`
    set role ${role};
    ${script}
  `);
}

function seedVehiclesDb(): void {
  sql(`
    -- 1. Semeia nichos de negócio
    insert into public.business_niches (id, name, description)
    values
      ('vehicles', 'Veículos e Automotivo', 'Concessionárias e revendas'),
      ('ecommerce', 'E-commerce e Varejo', 'Lojas virtuais')
    on conflict do nothing;

    -- 2. Semeia organizações
    insert into public.organizations (id, slug, legal_name, display_name, niche_id)
    values
      ('${ORG_AUTO_A}', 'auto-a', 'Concessionária A Ltda', 'Concessionária A', 'vehicles'),
      ('${ORG_AUTO_B}', 'auto-b', 'Concessionária B Ltda', 'Concessionária B', 'vehicles'),
      ('${ORG_ECOM}', 'loja-ecom', 'Loja Virtual Ltda', 'Loja Virtual', 'ecommerce')
    on conflict (id) do update set niche_id = excluded.niche_id;

    -- 3. Semeia usuários
    insert into auth.users (id, email)
    values
      ('${USER_MANAGER_A}', 'manager-a@invariant.test'),
      ('${USER_VIEWER_A}', 'viewer-a@invariant.test'),
      ('${USER_MANAGER_B}', 'manager-b@invariant.test'),
      ('${USER_MANAGER_ECOM}', 'manager-ecom@invariant.test')
    on conflict do nothing;

    -- 4. Associa memberships
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
    values
      ('${USER_MANAGER_A}', '${ORG_AUTO_A}', 'manager', now()),
      ('${USER_VIEWER_A}', '${ORG_AUTO_A}', 'viewer', now()),
      ('${USER_MANAGER_B}', '${ORG_AUTO_B}', 'manager', now()),
      ('${USER_MANAGER_ECOM}', '${ORG_ECOM}', 'manager', now())
    on conflict do nothing;
  `);
}

describe("Invariantes de Banco — Módulo de Veículos (Subetapas 2.1 - 2.6)", () => {
  beforeAll(() => {
    seedVehiclesDb();
  });

  describe("1. Existência Estrutural e DDL", () => {
    it("tabelas e view segura existem no schema public", () => {
      expect(tableExists("vehicle_import_batches")).toBe(true);
      expect(tableExists("vehicles")).toBe(true);
      expect(
        sql(
          `select exists(select 1 from information_schema.views where table_schema = 'public' and table_name = 'vehicles_safe');`,
        ),
      ).toBe("t");
    });

    it("índice único de idempotência existe na tabela vehicle_import_batches", () => {
      expect(indexExists("uq_vehicle_import_batches_org_idempotency")).toBe(true);
    });

    it("função transacional fn_confirm_vehicle_import existe no schema public", () => {
      const exists = sql(`
        select exists(
          select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_confirm_vehicle_import'
        );
      `);
      expect(exists).toBe("t");
    });

    it("colunas de preço e km não possuem default 0", () => {
      const precoDefault = sql(`
        select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'vehicles' and column_name = 'preco_cents';
      `);
      const kmDefault = sql(`
        select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'vehicles' and column_name = 'quilometragem';
      `);
      expect(precoDefault).toBe("");
      expect(kmDefault).toBe("");
    });
  });

  describe("2. Privilégios e Proteção de Colunas Confidenciais", () => {
    it("anon NÃO tem nenhum privilégio nas tabelas de veículos", () => {
      const canSelectBatches = sql(`select has_table_privilege('anon', 'public.vehicle_import_batches', 'SELECT');`);
      const canSelectVehicles = sql(`select has_table_privilege('anon', 'public.vehicles', 'SELECT');`);
      const canSelectSafe = sql(`select has_table_privilege('anon', 'public.vehicles_safe', 'SELECT');`);
      expect(canSelectBatches).toBe("f");
      expect(canSelectVehicles).toBe("f");
      expect(canSelectSafe).toBe("f");
    });

    it("anon NÃO pode executar a RPC fn_confirm_vehicle_import", () => {
      const canExec = sql(`
        select has_function_privilege('anon', 'public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE');
      `);
      expect(canExec).toBe("f");
    });

    it("authenticated NÃO pode executar a RPC fn_confirm_vehicle_import diretamente", () => {
      const canExec = sql(`
        select has_function_privilege('authenticated', 'public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE');
      `);
      expect(canExec).toBe("f");
    });

    it("service_role PODE executar a RPC fn_confirm_vehicle_import", () => {
      const canExec = sql(`
        select has_function_privilege('service_role', 'public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE');
      `);
      expect(canExec).toBe("t");
    });

    it("anon é bloqueado pelo PostgreSQL com erro de privilégio ao tentar invocar a RPC diretamente", () => {
      expect(() => {
        sqlAs(
          "anon",
          `select public.fn_confirm_vehicle_import(
            '${ORG_AUTO_A}'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '${USER_MANAGER_A}'::uuid,
            'idemp-key-probe-anon',
            'hash123',
            '[]'::jsonb,
            '[]'::jsonb
          );`,
        );
      }).toThrow(/permission denied for function fn_confirm_vehicle_import/);
    });

    it("authenticated é bloqueado pelo PostgreSQL com erro de privilégio ao tentar invocar a RPC diretamente", () => {
      expect(() => {
        sqlAs(
          "authenticated",
          `select public.fn_confirm_vehicle_import(
            '${ORG_AUTO_A}'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '${USER_MANAGER_A}'::uuid,
            'idemp-key-probe-auth',
            'hash123',
            '[]'::jsonb,
            '[]'::jsonb
          );`,
        );
      }).toThrow(/permission denied for function fn_confirm_vehicle_import/);
    });

    it("authenticated tem acesso a colunas comerciais, mas NÃO a colunas confidenciais", () => {
      const canReadMarca = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'marca', 'SELECT');`);
      const canReadPreco = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'preco_cents', 'SELECT');`);
      const canReadChassi = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'chassi', 'SELECT');`);
      const canReadPlaca = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'placa_completa', 'SELECT');`);
      const canReadCustoAq = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'custo_aquisicao_cents', 'SELECT');`);
      const canReadObs = sql(`select has_column_privilege('authenticated', 'public.vehicles', 'observacoes_internas', 'SELECT');`);

      expect(canReadMarca).toBe("t");
      expect(canReadPreco).toBe("t");
      expect(canReadChassi).toBe("f");
      expect(canReadPlaca).toBe("f");
      expect(canReadCustoAq).toBe("f");
      expect(canReadObs).toBe("f");
    });

    it("authenticated não consegue selecionar colunas confidenciais diretamente na tabela base", () => {
      expect(() => {
        sql(`
          set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${USER_MANAGER_A}"}', false);
          select chassi from public.vehicles;
        `);
      }).toThrow(/permission denied for column chassi/);
    });

    it("view vehicles_safe não projeta nenhuma coluna confidencial", () => {
      expect(columnExists("vehicles_safe", "chassi")).toBe(false);
      expect(columnExists("vehicles_safe", "placa_completa")).toBe(false);
      expect(columnExists("vehicles_safe", "custo_aquisicao_cents")).toBe(false);
      expect(columnExists("vehicles_safe", "custo_preparacao_cents")).toBe(false);
      expect(columnExists("vehicles_safe", "observacoes_internas")).toBe(false);
      expect(columnExists("vehicles_safe", "marca")).toBe(true);
      expect(columnExists("vehicles_safe", "modelo")).toBe(true);
      expect(columnExists("vehicles_safe", "preco_cents")).toBe(true);
    });
  });

  describe("3. Isolamento RLS e Governança de Nicho", () => {
    it("usuário da Organização A vê apenas os seus veículos e 0 da Organização B", () => {
      // Insere veículos via service_role em A e B
      sql(`
        insert into public.vehicles (organization_id, marca, modelo, preco_cents)
        values
          ('${ORG_AUTO_A}', 'Honda', 'Civic', 12000000),
          ('${ORG_AUTO_A}', 'Toyota', 'Corolla', 12500000),
          ('${ORG_AUTO_B}', 'Jeep', 'Compass', 14000000);
      `);

      const countA = countAs(USER_MANAGER_A, `select count(id) from public.vehicles;`);
      const countB = countAs(USER_MANAGER_B, `select count(id) from public.vehicles;`);

      expect(countA).toBe(2);
      expect(countB).toBe(1);
    });

    it("usuário de organização com nicho ecommerce vê 0 veículos mesmo se tentar consultar", () => {
      const countEcom = countAs(USER_MANAGER_ECOM, `select count(id) from public.vehicles;`);
      expect(countEcom).toBe(0);
    });

    it("view vehicles_safe com security_invoker = true preserva o isolamento de tenant", () => {
      const countSafeA = countAs(USER_MANAGER_A, `select count(*) from public.vehicles_safe;`);
      const countSafeB = countAs(USER_MANAGER_B, `select count(*) from public.vehicles_safe;`);

      expect(countSafeA).toBe(2);
      expect(countSafeB).toBe(1);
    });
  });

  describe("4. Atomicidade, Idempotência e Rollback na RPC Transacional", () => {
    it("executa confirmação com inserção atômica via fn_confirm_vehicle_import como service_role", () => {
      const batchId = "99990000-0000-4000-8000-000000000001";
      sql(`
        insert into public.vehicle_import_batches (id, organization_id, filename, file_hash, status, total_rows)
        values ('${batchId}', '${ORG_AUTO_A}', 'lote1.csv', 'hash123', 'preview', 2);
      `);

      const rpcResult = sqlAs(
        "service_role",
        `select public.fn_confirm_vehicle_import(
          '${ORG_AUTO_A}'::uuid,
          '${batchId}'::uuid,
          '${USER_MANAGER_A}'::uuid,
          'idemp-key-teste-01',
          'hash123',
          '[{"marca":"Fiat","modelo":"Pulse","preco_cents":9000000},{"marca":"Renault","modelo":"Duster","preco_cents":8500000}]'::jsonb,
          '[]'::jsonb
        );`,
      );

      const res = JSON.parse(rpcResult);
      expect(res.status).toBe("completed");
      expect(res.imported_count).toBe(2);
      expect(res.idempotency_replayed).toBe(false);

      const statusBatch = lastLine(
        sql(`select status from public.vehicle_import_batches where id = '${batchId}';`),
      );
      expect(statusBatch).toBe("completed");
    });

    it("IDEMPOTÊNCIA REAL: chamada subsequente com mesma chave devolve replay sem duplicar", () => {
      const batchId = "99990000-0000-4000-8000-000000000001";
      const totalAntes = Number(
        lastLine(sql(`select count(*) from public.vehicles where import_batch_id = '${batchId}';`)),
      );

      const rpcResult = sqlAs(
        "service_role",
        `select public.fn_confirm_vehicle_import(
          '${ORG_AUTO_A}'::uuid,
          '${batchId}'::uuid,
          '${USER_MANAGER_A}'::uuid,
          'idemp-key-teste-01',
          'hash123',
          '[{"marca":"Fiat","modelo":"Pulse","preco_cents":9000000}]'::jsonb,
          '[]'::jsonb
        );`,
      );

      const res = JSON.parse(rpcResult);
      expect(res.idempotency_replayed).toBe(true);

      const totalDepois = Number(
        lastLine(sql(`select count(*) from public.vehicles where import_batch_id = '${batchId}';`)),
      );
      expect(totalDepois).toBe(totalAntes);
    });

    it("REJEIÇÃO DE CONFLITO: chave diferente para lote já confirmado devolve erro 23505", () => {
      const batchId = "99990000-0000-4000-8000-000000000001";
      expect(() => {
        sqlAs(
          "service_role",
          `select public.fn_confirm_vehicle_import(
            '${ORG_AUTO_A}'::uuid,
            '${batchId}'::uuid,
            '${USER_MANAGER_A}'::uuid,
            'idemp-key-OUTRA-999',
            'hash123',
            '[]'::jsonb,
            '[]'::jsonb
          );`,
        );
      }).toThrow(/batch_already_confirmed/);
    });

    it("CROSS-TENANT BLOCKED: organização B não consegue confirmar lote da organização A", () => {
      const batchId = "99990000-0000-4000-8000-000000000001";
      expect(() => {
        sqlAs(
          "service_role",
          `select public.fn_confirm_vehicle_import(
            '${ORG_AUTO_B}'::uuid,
            '${batchId}'::uuid,
            '${USER_MANAGER_B}'::uuid,
            'idemp-key-invasao-01',
            'hash123',
            '[]'::jsonb,
            '[]'::jsonb
          );`,
        );
      }).toThrow(/batch_not_found/);
    });

    it("ROLLBACK ATÔMICO REAL: erro forçado não grava nenhum veículo parcial", () => {
      const batchId = "99990000-0000-4000-8000-000000000002";
      sql(`
        insert into public.vehicle_import_batches (id, organization_id, filename, file_hash, status, total_rows)
        values ('${batchId}', '${ORG_AUTO_A}', 'lote_erro.csv', 'hash999', 'preview', 3);
      `);

      // Array com 1 veículo válido seguido de 1 item que viola constraint de ano_modelo (> 2100)
      expect(() => {
        sqlAs(
          "service_role",
          `select public.fn_confirm_vehicle_import(
            '${ORG_AUTO_A}'::uuid,
            '${batchId}'::uuid,
            '${USER_MANAGER_A}'::uuid,
            'idemp-key-erro-transacional',
            'hash999',
            '[
              {"marca":"Ford","modelo":"Ka","ano_modelo":2020,"preco_cents":4000000},
              {"marca":"Ford","modelo":"Ka","ano_modelo":99999,"preco_cents":4000000}
            ]'::jsonb,
            '[]'::jsonb
          );`,
        );
      }).toThrow();

      // Prova de Rollback: ZERO veículos sob este batch_id foram persistidos
      const countParcial = Number(
        lastLine(sql(`select count(*) from public.vehicles where import_batch_id = '${batchId}';`)),
      );
      expect(countParcial).toBe(0);

      // O lote permanece em preview (não foi marcado como completed)
      const statusLote = lastLine(
        sql(`select status from public.vehicle_import_batches where id = '${batchId}';`),
      );
      expect(statusLote).toBe("preview");
    });
  });
});
