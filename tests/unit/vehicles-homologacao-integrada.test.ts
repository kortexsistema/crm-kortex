// @vitest-environment node
/**
 * KORTEX — HOMOLOGAÇÃO TÉCNICA INTEGRADA DO MÓDULO DE VEÍCULOS (Subetapa 2.5)
 *
 * Suíte de homologação cobrindo:
 * 1. Fluxo integrado de importação (upload, preview, conferência, confirmação, idempotência e concorrência).
 * 2. Análise e validação da atomicidade da persistência e compensação de erro.
 * 3. Consultas estruturadas via MCP (crm_search_vehicles, crm_get_vehicle).
 * 4. Simulação de conversação do Agente de Atendimento com perguntas reais de clientes:
 *    - "Quais Gol estão disponíveis?"
 *    - "Quais são os mais baratos?"
 *    - "Vocês têm algum veículo abaixo de R$ 40 mil?"
 *    - "Quantos veículos estão disponíveis?"
 *    - "Mostre os próximos resultados."
 * 5. Verificação de ausência de vazamento de dados confidenciais e isolamento multi-tenant.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST as previewHandler } from "@/app/api/v1/vehicles/import/preview/route";
import { POST as confirmHandler } from "@/app/api/v1/vehicles/import/confirm/route";
import { crmSearchVehicles, crmGetVehicle } from "@/lib/mcp/tools/veiculos";
import { pickToolsFromMcp, type PickToolsInput } from "@/lib/ai/runtime/tools";
import type { RoleCheck } from "@/lib/auth/require-role";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";
import type { McpContext } from "@/lib/mcp/types";
import type { Actor } from "@/lib/api/handlers/types";

const ORG_VEHICLES_A = "11111111-1111-4111-8111-111111111111";
const ORG_VEHICLES_B = "22222222-2222-4222-8222-222222222222";
const USER_GESTOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mockUser: AuthUser = {
  id: USER_GESTOR_A,
  email: "gestor@concessionaria-a.com",
  full_name: "Gestor Frota A",
  avatar_url: null,
  idioma: "pt-BR",
  support: null,
  is_platform_admin: false,
  organizations: [],
};

const mockOrgA: ActiveOrg = {
  orgId: ORG_VEHICLES_A,
  name: "Concessionária A",
  role: "manager",
  niche_id: "vehicles",
};

describe("Kortex Subetapa 2.5: Homologação Integrada de Veículos", () => {
  let inMemoryBatches: Map<string, Record<string, unknown>>;
  let inMemoryVehicles: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemoryBatches = new Map();
    inMemoryVehicles = [];

    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: mockUser,
      org: mockOrgA,
    } as RoleCheck);

    vi.mocked(createClient).mockImplementation(() => createMockSupabase() as never);
    vi.mocked(createAdminClient).mockImplementation(() => createMockSupabase() as never);
  });

  function createMockSupabase(options?: {
    forcedInsertError?: boolean;
    activeOrgId?: string;
    activeNiche?: string | null;
  }) {
    const _currentOrgId = options?.activeOrgId ?? ORG_VEHICLES_A;
    const currentNiche = options?.activeNiche !== undefined ? options.activeNiche : "vehicles";

    return {
      from: (tabela: string) => {
        if (tabela === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: currentNiche ? { niche_id: currentNiche } : null,
                  error: null,
                }),
              }),
            }),
          };
        }

        if (tabela === "vehicle_import_batches") {
          return {
            insert: (data: Record<string, unknown>) => {
              const id = (data.id as string) || "batch-uuid-test";
              const record = { id, ...data, updated_at: new Date().toISOString() };
              inMemoryBatches.set(id, record);
              return {
                select: () => ({
                  single: async () => ({ data: record, error: null }),
                  maybeSingle: async () => ({ data: record, error: null }),
                }),
              };
            },
            select: () => {
              const filters: Record<string, unknown> = {};
              const chain = {
                eq: (col: string, val: unknown) => {
                  filters[col] = val;
                  return chain;
                },
                maybeSingle: async () => {
                  const id = filters["id"] as string | undefined;
                  const b = id ? inMemoryBatches.get(id) : Array.from(inMemoryBatches.values())[0];
                  if (filters["organization_id"] && b && b.organization_id !== filters["organization_id"]) {
                    return { data: null, error: null };
                  }
                  return { data: b ? { ...b } : null, error: null };
                },
                single: async () => {
                  const id = filters["id"] as string | undefined;
                  const b = id ? inMemoryBatches.get(id) : Array.from(inMemoryBatches.values())[0];
                  return { data: b ? { ...b } : null, error: b ? null : { message: "not found" } };
                },
              };
              return chain;
            },
            update: (patch: Record<string, unknown>) => {
              const filters: Record<string, unknown> = {};
              const applyUpdate = () => {
                const id = filters["id"] as string | undefined;
                const current = id ? inMemoryBatches.get(id) : Array.from(inMemoryBatches.values())[0];
                if (!current) return { data: null, error: null };
                if (filters["organization_id"] && current.organization_id !== filters["organization_id"]) {
                  return { data: null, error: null };
                }
                if (filters["status"] && current.status !== filters["status"]) {
                  return { data: null, error: null };
                }
                const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
                if (id) inMemoryBatches.set(id, updated);
                return { data: updated, error: null };
              };
              const chain = {
                eq: (col: string, val: unknown) => {
                  filters[col] = val;
                  return chain;
                },
                select: () => ({
                  maybeSingle: async () => applyUpdate(),
                  single: async () => applyUpdate(),
                }),
                maybeSingle: async () => applyUpdate(),
                single: async () => applyUpdate(),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(applyUpdate()).then(resolve),
              };
              return chain;
            },
          };
        }

        if (tabela === "vehicles" || tabela === "vehicles_safe") {
          return {
            insert: async (chunk: Array<Record<string, unknown>>) => {
              if (options?.forcedInsertError) {
                return { error: { message: "Simulação de falha de conexão com PostgreSQL" } };
              }
              for (const item of chunk) {
                inMemoryVehicles.push({
                  id: item.id || `veh-${inMemoryVehicles.length + 1}`,
                  ...item,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              }
              return { error: null };
            },
            delete: () => {
              const filters: Record<string, unknown> = {};
              const chain = {
                eq: (col: string, val: unknown) => {
                  filters[col] = val;
                  return chain;
                },
                then: (resolve: (v: unknown) => unknown) => {
                  inMemoryVehicles = inMemoryVehicles.filter((v) => {
                    for (const [k, val] of Object.entries(filters)) {
                      if (v[k] === val) return false;
                    }
                    return true;
                  });
                  return Promise.resolve(resolve({ data: null, error: null }));
                },
              };
              return chain;
            },
            select: (_cols?: string, selectOpts?: { count?: string }) => {
              const filtersEq: Record<string, unknown> = {};
              const filtersIlike: Record<string, string> = {};
              const filtersGte: Record<string, number> = {};
              const filtersLte: Record<string, number> = {};
              const orderRules: Array<{ col: string; ascending: boolean }> = [];
              let rangeFrom = 0;
              let rangeTo = 999;

              const chain = {
                eq: (col: string, val: unknown) => {
                  filtersEq[col] = val;
                  return chain;
                },
                or: (_expr: string) => {
                  // Simulação de verificação de duplicidades no estoque
                  return chain;
                },
                in: (_col: string, _vals: unknown[]) => {
                  return chain;
                },
                ilike: (col: string, val: string) => {
                  filtersIlike[col] = val.replace(/%/g, "").toLowerCase();
                  return chain;
                },
                gte: (col: string, val: number) => {
                  filtersGte[col] = val;
                  return chain;
                },
                lte: (col: string, val: number) => {
                  filtersLte[col] = val;
                  return chain;
                },
                order: (col: string, opts?: { ascending?: boolean }) => {
                  orderRules.push({ col, ascending: opts?.ascending ?? false });
                  return chain;
                },
                range: (from: number, to: number) => {
                  rangeFrom = from;
                  rangeTo = to;
                  return chain;
                },
                maybeSingle: async () => {
                  const match = inMemoryVehicles.find((v) => {
                    for (const [k, val] of Object.entries(filtersEq)) {
                      if (v[k] !== val) return false;
                    }
                    return true;
                  });
                  return { data: match ? { ...match } : null, error: null };
                },
                then: (resolve: (v: unknown) => unknown) => {
                  const filtered = inMemoryVehicles.filter((v) => {
                    for (const [k, val] of Object.entries(filtersEq)) {
                      if (v[k] !== val) return false;
                    }
                    for (const [k, val] of Object.entries(filtersIlike)) {
                      const str = String(v[k] ?? "").toLowerCase();
                      if (!str.includes(val)) return false;
                    }
                    for (const [k, val] of Object.entries(filtersGte)) {
                      if (v[k] === null || v[k] === undefined || (v[k] as number) < val) return false;
                    }
                    for (const [k, val] of Object.entries(filtersLte)) {
                      if (v[k] === null || v[k] === undefined || (v[k] as number) > val) return false;
                    }
                    return true;
                  });

                  // Ordenação multi-critério
                  if (orderRules.length > 0) {
                    filtered.sort((a, b) => {
                      for (const { col, ascending } of orderRules) {
                        const valA = a[col];
                        const valB = b[col];
                        if (valA === valB) continue;
                        if (valA === null || valA === undefined) return 1;
                        if (valB === null || valB === undefined) return -1;
                        if (ascending) return valA > valB ? 1 : -1;
                        return valA < valB ? 1 : -1;
                      }
                      return String(a.id).localeCompare(String(b.id));
                    });
                  }

                  const total = filtered.length;
                  const paged = filtered.slice(rangeFrom, rangeTo + 1);

                  return Promise.resolve(
                    resolve({
                      data: paged.map((v) => {
                        // Projeção segura de vehicles_safe (sem campos confidenciais)
                        const {
                          placa_completa: _pc,
                          chassi: _ch,
                          custo_aquisicao_cents: _ca,
                          custo_preparacao_cents: _cp,
                          observacoes_internas: _oi,
                          ...safeRow
                        } = v;
                        return safeRow;
                      }),
                      count: selectOpts?.count === "exact" ? total : null,
                      error: null,
                    }),
                  );
                },
              };
              return chain;
            },
          };
        }

        throw new Error(`Tabela não mockada: ${tabela}`);
      },
      rpc: async (fnName: string, params: Record<string, unknown>) => {
        if (fnName === "fn_confirm_vehicle_import") {
          if (options?.forcedInsertError) {
            return { data: null, error: { message: "Simulated database transaction rollback" } };
          }
          const batchId = params.p_batch_id as string;
          const orgId = params.p_org_id as string;
          const idempotencyKey = params.p_idempotency_key as string;
          const fileHash = params.p_file_hash as string;
          const vehicles = (params.p_vehicles as Array<Record<string, unknown>>) || [];
          const errors = (params.p_errors as Array<Record<string, unknown>>) || [];

          const batch = inMemoryBatches.get(batchId);
          if (!batch || batch.organization_id !== orgId) {
            return { data: null, error: { message: "batch_not_found" } };
          }

          if (batch.status === "completed") {
            const bMeta = (batch.metadata as Record<string, unknown>) || {};
            if (batch.idempotency_key === idempotencyKey || bMeta.idempotency_key === idempotencyKey) {
              return {
                data: {
                  batch_id: batch.id,
                  status: "completed",
                  total_rows: batch.total_rows,
                  imported_count: batch.imported_count,
                  duplicate_count: batch.duplicate_count,
                  error_count: batch.error_count,
                  confirmed_at: batch.confirmed_at || batch.updated_at,
                  idempotency_replayed: true,
                },
                error: null,
              };
            }
            return { data: null, error: { message: "batch_already_confirmed" } };
          }

          if (batch.status !== "preview") {
            return { data: null, error: { message: "invalid_batch_status" } };
          }

          if (batch.file_hash && fileHash && batch.file_hash !== fileHash) {
            return { data: null, error: { message: "file_hash_mismatch" } };
          }

          const inserted: Array<Record<string, unknown>> = [];
          for (const v of vehicles) {
            const record = {
              id: `veh-${inMemoryVehicles.length + 1}`,
              organization_id: orgId,
              import_batch_id: batchId,
              ...v,
            };
            inserted.push(record);
          }
          inMemoryVehicles.push(...inserted);

          const confirmedAt = new Date().toISOString();
          const updatedBatch = {
            ...batch,
            status: "completed",
            idempotency_key: idempotencyKey,
            imported_count: inserted.length,
            confirmed_at: confirmedAt,
            metadata: {
              ...((batch.metadata as Record<string, unknown>) || {}),
              idempotency_key: idempotencyKey,
              completed_at: confirmedAt,
            },
          };
          inMemoryBatches.set(batchId, updatedBatch);

          return {
            data: {
              batch_id: batchId,
              status: "completed",
              total_rows: batch.total_rows,
              imported_count: inserted.length,
              duplicate_count: batch.duplicate_count,
              error_count: errors.length,
              confirmed_at: confirmedAt,
              idempotency_replayed: false,
            },
            error: null,
          };
        }
        return { data: null, error: { message: `unknown function ${fnName}` } };
      },
    };
  }

  // Planilha de teste fictícia com 5 veículos (incluindo 2 Gols e faixa de preços variada)
  const csvFicticio = `marca,modelo,versao,ano_fabricacao,ano_modelo,cor,combustivel,cambio,km,preco,status,placa,chassi
Volkswagen,Gol,1.0 MPI Trendline,2021,2022,Branco,flex,manual,45000,55900,disponivel,ABC1D23,9BWZZZ377VT001001
Volkswagen,Gol,1.6 MSI Automático,2020,2021,Prata,flex,automatico,58000,62900,disponivel,DEF2E34,9BWZZZ377VT001002
Chevrolet,Onix,1.0 Turbo Premier,2022,2023,Preto,flex,automatico,29000,78000,disponivel,GHI3F45,9BGZZZ377VT001003
Fiat,Mobi,1.0 Like,2019,2020,Vermelho,flex,manual,72000,38500,disponivel,JKL4G56,9BDZZZ377VT001004
Toyota,Corolla,2.0 XEi,2021,2022,Cinza,flex,cvt,35000,125000,disponivel,MNO5H67,9BRZZZ377VT001005`;

  // -------------------------------------------------------------------------
  // 1. Homologação do Fluxo de Importação
  // -------------------------------------------------------------------------
  describe("1. Fluxo de Importação, Idempotência e Concorrência", () => {
    it("executa ciclo completo: preview -> confirmação explícita -> estoque persistido", async () => {
      const mockSb = createMockSupabase();
      vi.mocked(createClient).mockResolvedValue(mockSb as never);

      // A. Upload e Pré-Visualização
      const formDataPreview = new FormData();
      const file = new File([csvFicticio], "estoque_teste.csv", { type: "text/csv" });
      formDataPreview.append("file", file);

      const reqPreview = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: formDataPreview,
      });

      const resPreview = await previewHandler(reqPreview);
      expect(resPreview.status).toBe(200);
      const jsonPreview = await resPreview.json();

      expect(jsonPreview.data.resumo.total_linhas).toBe(5);
      expect(jsonPreview.data.resumo.validos_count).toBe(5);
      expect(jsonPreview.data.resumo.erros_count).toBe(0);
      expect(jsonPreview.data.batch_id).toBeDefined();

      const batchId = jsonPreview.data.batch_id;
      const idempotencyKey = "idemp-key-teste-12345";

      // B. Confirmação do Lote
      const formDataConfirm = new FormData();
      formDataConfirm.append("file", file);
      formDataConfirm.append("batch_id", batchId);
      formDataConfirm.append("idempotency_key", idempotencyKey);

      const reqConfirm = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: formDataConfirm,
      });

      const resConfirm = await confirmHandler(reqConfirm);
      expect(resConfirm.status).toBe(200);
      const jsonConfirm = await resConfirm.json();

      expect(jsonConfirm.data.status).toBe("completed");
      expect(jsonConfirm.data.imported_count).toBe(5);

      // C. Verificação de veículos persistidos no banco
      expect(inMemoryVehicles).toHaveLength(5);
      expect(inMemoryVehicles.map((v) => v.modelo)).toContain("Gol");
      expect(inMemoryVehicles.map((v) => v.modelo)).toContain("Mobi");

      // D. Reenvio da mesma confirmação (Idempotência com nova requisição)
      const formConfirm2 = new FormData();
      const file2 = new File([csvFicticio], "estoque_teste.csv", { type: "text/csv" });
      formConfirm2.append("file", file2);
      formConfirm2.append("batch_id", batchId);
      formConfirm2.append("idempotency_key", idempotencyKey);

      const reqConfirm2 = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: formConfirm2,
      });

      const resConfirm2 = await confirmHandler(reqConfirm2);
      expect(resConfirm2.status).toBe(200);
      const jsonConfirm2 = await resConfirm2.json();

      expect(jsonConfirm2.data.status).toBe("completed");
      expect(jsonConfirm2.data.idempotency_replayed).toBe(true);
      // NENHUM veículo duplicado inserido
      expect(inMemoryVehicles).toHaveLength(5);
    });

    it("rejeita arquivo modificado entre preview e confirmação (integridade de hash)", async () => {
      const mockSb = createMockSupabase();
      vi.mocked(createClient).mockResolvedValue(mockSb as never);

      // Preview com arquivo original
      const file1 = new File([csvFicticio], "original.csv", { type: "text/csv" });
      const formPrev = new FormData();
      formPrev.append("file", file1);
      const resPrev = await previewHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/preview", { method: "POST", body: formPrev }),
      );
      const jsonPrev = await resPrev.json();
      const batchId = jsonPrev.data.batch_id;

      // Confirmação com arquivo alterado (hash diferente)
      const fileAdulterado = new File([csvFicticio + "\nFiat,Uno,1.0,2015,2016,Prata,flex,manual,90000,25000,disponivel,XYZ9W88,9BDZZZ377VT999999"], "adulterado.csv", { type: "text/csv" });
      const formConf = new FormData();
      formConf.append("file", fileAdulterado);
      formConf.append("batch_id", batchId);
      formConf.append("idempotency_key", "idemp-key-adulterado");

      const resConf = await confirmHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/confirm", { method: "POST", body: formConf }),
      );

      expect(resConf.status).toBe(422);
      const jsonErr = await resConf.json();
      expect(jsonErr.error.code).toBe("file_hash_mismatch");
      expect(inMemoryVehicles).toHaveLength(0);
    });

    it("rejeita confirmação concorrente e protege estado do lote", async () => {
      const mockSb = createMockSupabase();
      vi.mocked(createClient).mockResolvedValue(mockSb as never);

      // Simula lote já em status 'processing' por outra requisição simultânea
      const batchId = "batch-lock-test";
      const hash = createHash("sha256").update(Buffer.from(csvFicticio)).digest("hex");
      inMemoryBatches.set(batchId, {
        id: batchId,
        organization_id: ORG_VEHICLES_A,
        status: "processing", // Trava de concorrência ativa
        file_hash: hash,
        metadata: {},
      });

      const file = new File([csvFicticio], "estoque.csv", { type: "text/csv" });
      const formConf = new FormData();
      formConf.append("file", file);
      formConf.append("batch_id", batchId);
      formConf.append("idempotency_key", "idemp-key-concorrente");

      const resConf = await confirmHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/confirm", { method: "POST", body: formConf }),
      );

      expect(resConf.status).toBe(409);
      const jsonErr = await resConf.json();
      expect(jsonErr.error.code).toBe("invalid_batch_status");
    });

    it("garante compensação e limpeza caso ocorra falha de inserção no banco", async () => {
      // Simula falha forçada de gravação no banco
      const mockSb = createMockSupabase({ forcedInsertError: true });
      vi.mocked(createClient).mockResolvedValue(mockSb as never);
      vi.mocked(createAdminClient).mockImplementation(() => mockSb as never);

      const file = new File([csvFicticio], "estoque.csv", { type: "text/csv" });
      const formPrev = new FormData();
      formPrev.append("file", file);
      const resPrev = await previewHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/preview", { method: "POST", body: formPrev }),
      );
      const jsonPrev = await resPrev.json();
      const batchId = jsonPrev.data.batch_id;

      const formConf = new FormData();
      formConf.append("file", file);
      formConf.append("batch_id", batchId);
      formConf.append("idempotency_key", "idemp-key-falha-simulada");

      const resConf = await confirmHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/confirm", { method: "POST", body: formConf }),
      );

      expect(resConf.status).toBe(500);
      const jsonErr = await resConf.json();
      expect(jsonErr.error.code).toBe("persistence_failed");

      // Verificação de que NENHUM registro parcial restou
      expect(inMemoryVehicles).toHaveLength(0);

      // Verificação de rollback atômico: o lote permanece em 'preview'
      const batchSalvo = inMemoryBatches.get(batchId);
      expect(batchSalvo?.status).toBe("preview");
    });

    it("ISOLAMENTO ENTRE ORGANIZAÇÕES: organização B não acessa lote da organização A", async () => {
      const mockSb = createMockSupabase({ activeOrgId: ORG_VEHICLES_B });
      vi.mocked(createClient).mockResolvedValue(mockSb as never);
      vi.mocked(createAdminClient).mockImplementation(() => mockSb as never);

      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: true,
        user: mockUser,
        org: {
          orgId: ORG_VEHICLES_B,
          name: "Concessionária B",
          role: "manager",
          niche_id: "vehicles",
        },
      } as RoleCheck);

      // Lote criado pela organização A
      inMemoryBatches.set("batch-da-org-a", {
        id: "batch-da-org-a",
        organization_id: ORG_VEHICLES_A,
        status: "preview",
        file_hash: "hash-qualquer",
      });

      // Tentativa de confirmação pela organização B
      const file = new File([csvFicticio], "estoque.csv", { type: "text/csv" });
      const formConf = new FormData();
      formConf.append("file", file);
      formConf.append("batch_id", "batch-da-org-a");
      formConf.append("idempotency_key", "idemp-tentativa-cross-tenant");

      const resConf = await confirmHandler(
        new NextRequest("http://localhost/api/v1/vehicles/import/confirm", { method: "POST", body: formConf }),
      );

      expect(resConf.status).toBe(404);
      const jsonErr = await resConf.json();
      expect(jsonErr.error.code).toBe("batch_not_found");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Homologação das Ferramentas MCP sobre o Estoque Importado
  // -------------------------------------------------------------------------
  describe("2. Ferramentas MCP sobre Estoque Estruturado", () => {
    let mcpCtx: McpContext;

    beforeEach(async () => {
      // Popula estoque em memória com os 5 veículos da homologação
      const mockSb = createMockSupabase();
      inMemoryVehicles = [
        {
          id: "veh-gol-1",
          organization_id: ORG_VEHICLES_A,
          marca: "Volkswagen",
          modelo: "Gol",
          versao: "1.0 MPI Trendline",
          ano_fabricacao: 2021,
          ano_modelo: 2022,
          cor: "Branco",
          combustivel: "flex",
          cambio: "manual",
          quilometragem: 45000,
          preco_cents: 5590000, // R$ 55.900,00
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Ar condicionado", "Direção hidráulica"],
          fotos_urls: ["https://cdn.example.com/gol1.jpg"],
          placa_final: "3",
          placa_completa: "ABC1D23",
          chassi: "9BWZZZ377VT001001",
          custo_aquisicao_cents: 4200000,
          observacoes_internas: "Troca de correia feita",
        },
        {
          id: "veh-gol-2",
          organization_id: ORG_VEHICLES_A,
          marca: "Volkswagen",
          modelo: "Gol",
          versao: "1.6 MSI Automático",
          ano_fabricacao: 2020,
          ano_modelo: 2021,
          cor: "Prata",
          combustivel: "flex",
          cambio: "automatico",
          quilometragem: 58000,
          preco_cents: 6290000, // R$ 62.900,00
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Câmbio automático", "Sensor de ré"],
          fotos_urls: [],
          placa_final: "4",
          placa_completa: "DEF2E34",
          chassi: "9BWZZZ377VT001002",
          custo_aquisicao_cents: 4800000,
          observacoes_internas: "Pequeno retoque no parachoque",
        },
        {
          id: "veh-onix",
          organization_id: ORG_VEHICLES_A,
          marca: "Chevrolet",
          modelo: "Onix",
          versao: "1.0 Turbo Premier",
          ano_fabricacao: 2022,
          ano_modelo: 2023,
          cor: "Preto",
          combustivel: "flex",
          cambio: "automatico",
          quilometragem: 29000,
          preco_cents: 7800000, // R$ 78.000,00
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Bancos em couro", "MyLink"],
          fotos_urls: [],
          placa_final: "5",
        },
        {
          id: "veh-mobi",
          organization_id: ORG_VEHICLES_A,
          marca: "Fiat",
          modelo: "Mobi",
          versao: "1.0 Like",
          ano_fabricacao: 2019,
          ano_modelo: 2020,
          cor: "Vermelho",
          combustivel: "flex",
          cambio: "manual",
          quilometragem: 72000,
          preco_cents: 3850000, // R$ 38.500,00
          moeda: "BRL",
          status: "disponivel",
          opcionais: [],
          fotos_urls: [],
          placa_final: "6",
        },
        {
          id: "veh-corolla",
          organization_id: ORG_VEHICLES_A,
          marca: "Toyota",
          modelo: "Corolla",
          versao: "2.0 XEi",
          ano_fabricacao: 2021,
          ano_modelo: 2022,
          cor: "Cinza",
          combustivel: "flex",
          cambio: "cvt",
          quilometragem: 35000,
          preco_cents: 12500000, // R$ 125.000,00
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Piloto automático", "Câmera de ré"],
          fotos_urls: [],
          placa_final: "7",
        },
      ];

      const actor: Actor = {
        type: "ai_agent",
        id: "agent-simulador",
        role: "ai_operator",
        agent_id: "agent-leticia-veiculos",
      };

      mcpCtx = {
        organizationId: ORG_VEHICLES_A,
        role: "agent",
        actor,
        apiTokenId: "tok-simulacao",
        requestId: "req-simulacao",
        nicheId: "vehicles",
        supabase: mockSb as never,
      };
    });

    it("busca estruturada crm_search_vehicles não vaza colunas confidenciais", async () => {
      const res = (await crmSearchVehicles.handler({} as never, mcpCtx)) as {
        veiculos: Record<string, unknown>[];
      };

      expect(res.veiculos).toHaveLength(5);
      for (const v of res.veiculos) {
        expect(v).not.toHaveProperty("placa_completa");
        expect(v).not.toHaveProperty("chassi");
        expect(v).not.toHaveProperty("custo_aquisicao_cents");
        expect(v).not.toHaveProperty("observacoes_internas");
      }
    });

    it("detalhes crm_get_vehicle não vaza colunas confidenciais", async () => {
      const res = (await crmGetVehicle.handler({ vehicle_id: "veh-gol-1" }, mcpCtx)) as {
        encontrado: boolean;
        veiculo: Record<string, unknown>;
      };

      expect(res.encontrado).toBe(true);
      expect(res.veiculo).not.toHaveProperty("placa_completa");
      expect(res.veiculo).not.toHaveProperty("chassi");
      expect(res.veiculo).not.toHaveProperty("custo_aquisicao_cents");
      expect(res.veiculo).not.toHaveProperty("observacoes_internas");
      expect(res.veiculo.modelo).toBe("Gol");
      expect(res.veiculo.preco_formatado).toBe("R$\u00a055.900,00");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Simulação Conversacional do Agente com Perguntas Reais
  // -------------------------------------------------------------------------
  describe("3. Simulação de Perguntas e Respostas do Agente (Conversação Determinística)", () => {
    let pickInput: PickToolsInput;

    beforeEach(() => {
      const mockSb = createMockSupabase();
      inMemoryVehicles = [
        {
          id: "veh-gol-1",
          organization_id: ORG_VEHICLES_A,
          marca: "Volkswagen",
          modelo: "Gol",
          versao: "1.0 MPI Trendline",
          ano_modelo: 2022,
          cor: "Branco",
          cambio: "manual",
          quilometragem: 45000,
          preco_cents: 5590000,
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Ar condicionado", "Direção hidráulica"],
        },
        {
          id: "veh-gol-2",
          organization_id: ORG_VEHICLES_A,
          marca: "Volkswagen",
          modelo: "Gol",
          versao: "1.6 MSI Automático",
          ano_modelo: 2021,
          cor: "Prata",
          cambio: "automatico",
          quilometragem: 58000,
          preco_cents: 6290000,
          moeda: "BRL",
          status: "disponivel",
          opcionais: ["Câmbio automático"],
        },
        {
          id: "veh-mobi",
          organization_id: ORG_VEHICLES_A,
          marca: "Fiat",
          modelo: "Mobi",
          versao: "1.0 Like",
          ano_modelo: 2020,
          cor: "Vermelho",
          cambio: "manual",
          quilometragem: 72000,
          preco_cents: 3850000, // R$ 38.500,00 (único abaixo de 40k)
          moeda: "BRL",
          status: "disponivel",
          opcionais: [],
        },
        {
          id: "veh-corolla",
          organization_id: ORG_VEHICLES_A,
          marca: "Toyota",
          modelo: "Corolla",
          versao: "2.0 XEi",
          ano_modelo: 2022,
          cor: "Cinza",
          cambio: "cvt",
          quilometragem: 35000,
          preco_cents: 12500000,
          moeda: "BRL",
          status: "disponivel",
          opcionais: [],
        },
      ];

      const actor: Actor = {
        type: "ai_agent",
        id: "agent-leticia",
        role: "ai_operator",
        agent_id: "agent-1",
      };

      const mcpCtx: McpContext = {
        organizationId: ORG_VEHICLES_A,
        role: "agent",
        actor,
        apiTokenId: "tok-agent",
        requestId: "req-agent",
        nicheId: "vehicles",
        supabase: mockSb as never,
      };

      pickInput = {
        toolIds: ["crm_search_vehicles", "crm_get_vehicle"],
        auth: {
          organizationId: ORG_VEHICLES_A,
          role: "agent",
          actor,
          scopes: ["mcp:read"],
          apiTokenId: "tok-agent",
        },
        ctx: mcpCtx,
        supabase: mockSb as never,
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      };
    });

    it("Cenário A: 'Quais Gol estão disponíveis?' -> localiza exatamente os 2 Gols", async () => {
      const tools = pickToolsFromMcp(pickInput);
      const searchTool = tools.crm_search_vehicles!;
      expect(searchTool).toBeDefined();

      // Agente aciona a ferramenta com modelo Gol e status disponivel
      const resultRaw = await searchTool.execute!(
        {
          modelo: "Gol",
          status: "disponivel",
        },
        {} as never,
      );

      const res = resultRaw as {
        total: number;
        veiculos: Array<{ modelo: string; versao: string; preco_formatado: string }>;
      };

      expect(res.total).toBe(2);
      expect(res.veiculos).toHaveLength(2);
      expect(res.veiculos[0]!.modelo).toBe("Gol");
      expect(res.veiculos[1]!.modelo).toBe("Gol");
      expect(res.veiculos.map((v) => v.preco_formatado)).toContain("R$\u00a055.900,00");
      expect(res.veiculos.map((v) => v.preco_formatado)).toContain("R$\u00a062.900,00");
    });

    it("Cenário B: 'Quais são os mais baratos?' -> ordenação preco_asc com desempate determinístico", async () => {
      const tools = pickToolsFromMcp(pickInput);
      const searchTool = tools.crm_search_vehicles!;

      const resultRaw = await searchTool.execute!(
        {
          status: "disponivel",
          ordenacao: "preco_asc",
          limite: 10,
        },
        {} as never,
      );

      const res = resultRaw as {
        total: number;
        veiculos: Array<{ modelo: string; preco_cents: number; preco_formatado: string }>;
      };

      expect(res.total).toBe(4);
      // Primeiro deve ser o Mobi (R$ 38.500,00)
      expect(res.veiculos[0]!.modelo).toBe("Mobi");
      expect(res.veiculos[0]!.preco_formatado).toBe("R$\u00a038.500,00");
      // Segundo deve ser o Gol Trendline (R$ 55.900,00)
      expect(res.veiculos[1]!.modelo).toBe("Gol");
      expect(res.veiculos[1]!.preco_formatado).toBe("R$\u00a055.900,00");
      // Último deve ser o Corolla (R$ 125.000,00)
      expect(res.veiculos[3]!.modelo).toBe("Corolla");
      expect(res.veiculos[3]!.preco_formatado).toBe("R$\u00a0125.000,00");
    });

    it("Cenário C: 'Vocês têm algum veículo abaixo de R$ 40 mil?' -> filtro preco_max_cents", async () => {
      const tools = pickToolsFromMcp(pickInput);
      const searchTool = tools.crm_search_vehicles!;

      // 40 mil = 4000000 centavos
      const resultRaw = await searchTool.execute!(
        {
          preco_max_cents: 4000000,
          status: "disponivel",
        },
        {} as never,
      );

      const res = resultRaw as {
        total: number;
        veiculos: Array<{ modelo: string; preco_formatado: string }>;
      };

      expect(res.total).toBe(1);
      expect(res.veiculos[0]!.modelo).toBe("Mobi");
      expect(res.veiculos[0]!.preco_formatado).toBe("R$\u00a038.500,00");
    });

    it("Cenário D: 'Quantos veículos estão disponíveis?' -> interpreta contagem exata sem trazer tudo", async () => {
      const tools = pickToolsFromMcp(pickInput);
      const searchTool = tools.crm_search_vehicles!;

      const resultRaw = await searchTool.execute!(
        {
          status: "disponivel",
          limite: 1, // Não precisa puxar todos para saber o total
        },
        {} as never,
      );

      const res = resultRaw as {
        total: number;
        pagina: number;
        tem_mais: boolean;
      };

      expect(res.total).toBe(4);
      expect(res.tem_mais).toBe(true);
    });

    it("Cenário E: 'Mostre os próximos resultados.' -> navega para a página 2 determinística", async () => {
      const tools = pickToolsFromMcp(pickInput);
      const searchTool = tools.crm_search_vehicles!;

      // Página 1 com limite 2
      const pag1Raw = await searchTool.execute!(
        {
          status: "disponivel",
          pagina: 1,
          limite: 2,
          ordenacao: "preco_asc",
        },
        {} as never,
      );
      const p1 = pag1Raw as { total: number; veiculos: Array<{ id: string; modelo: string }>; tem_mais: boolean };
      expect(p1.total).toBe(4);
      expect(p1.veiculos).toHaveLength(2);
      expect(p1.tem_mais).toBe(true);
      const idsP1 = p1.veiculos.map((v) => v.id);

      // Página 2 com limite 2
      const pag2Raw = await searchTool.execute!(
        {
          status: "disponivel",
          pagina: 2,
          limite: 2,
          ordenacao: "preco_asc",
        },
        {} as never,
      );
      const p2 = pag2Raw as { total: number; veiculos: Array<{ id: string; modelo: string }>; tem_mais: boolean };
      expect(p2.total).toBe(4);
      expect(p2.veiculos).toHaveLength(2);
      expect(p2.tem_mais).toBe(false); // Fim dos resultados
      const idsP2 = p2.veiculos.map((v) => v.id);

      // Nenhuma sobreposição de itens entre página 1 e página 2
      for (const id of idsP2) {
        expect(idsP1).not.toContain(id);
      }
    });
  });
});
