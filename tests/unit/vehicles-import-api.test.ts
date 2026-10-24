// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { POST as previewHandler } from "@/app/api/v1/vehicles/import/preview/route";
import { POST as confirmHandler } from "@/app/api/v1/vehicles/import/confirm/route";
import type { RoleCheck } from "@/lib/auth/require-role";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";

const mockUser: AuthUser = {
  id: USER_ID,
  email: "gestor@auto.com",
  full_name: "Gestor Auto",
  avatar_url: null,
  idioma: "pt-BR",
  support: null,
  is_platform_admin: false,
  organizations: [],
};

const mockOrg: ActiveOrg = {
  orgId: ORG_ID,
  name: "Auto Shop",
  role: "manager",
  niche_id: "vehicles",
};

describe("Subetapa 2.3: API de Importação de Veículos (Preview & Confirm)", () => {
  let batchesDb: Map<string, Record<string, unknown>>;
  let vehiclesDb: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    batchesDb = new Map();
    vehiclesDb = [];

    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: mockUser,
      org: mockOrg,
    } as RoleCheck);

    vi.mocked(createClient).mockImplementation(() => makeMockSupabase() as never);
    vi.mocked(createAdminClient).mockImplementation(() => makeMockSupabase() as never);
  });

  function makeMockSupabase(options?: {
    nicheId?: string | null;
    existingVehicles?: Array<{ id: string; chassi?: string; placa_completa?: string }>;
    insertError?: boolean;
    updateBatchError?: boolean;
  }) {
    const niche = options?.nicheId !== undefined ? options.nicheId : "vehicles";
    const existing = options?.existingVehicles ?? [];

    return {
      from: (tabela: string) => {
        if (tabela === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: niche ? { niche_id: niche } : null,
                  error: null,
                }),
              }),
            }),
          };
        }

        if (tabela === "vehicle_import_batches") {
          return {
            insert: (data: Record<string, unknown>) => {
              const id = (data.id as string) || BATCH_ID;
              const record = { id, ...data, updated_at: new Date().toISOString() };
              batchesDb.set(id, record);
              return {
                select: () => ({
                  single: async () => ({ data: record, error: null }),
                  maybeSingle: async () => ({ data: record, error: null }),
                }),
              };
            },
            select: () => {
              const filters: Record<string, string> = {};
              const chain = {
                eq: (col: string, val: string) => {
                  filters[col] = val;
                  return chain;
                },
                maybeSingle: async () => {
                  const id = filters["id"];
                  const b = id ? batchesDb.get(id) : Array.from(batchesDb.values())[0];
                  if (filters["organization_id"] && b && b.organization_id !== filters["organization_id"]) {
                    return { data: null, error: null };
                  }
                  return { data: b ?? null, error: null };
                },
                single: async () => {
                  const id = filters["id"];
                  const b = id ? batchesDb.get(id) : Array.from(batchesDb.values())[0];
                  return { data: b ?? null, error: b ? null : { message: "not found" } };
                },
              };
              return chain;
            },
            update: (patch: Record<string, unknown>) => {
              const filters: Record<string, string> = {};
              const applyUpdate = () => {
                if (options?.updateBatchError) return { data: null, error: { message: "update failed" } };
                const id = filters["id"];
                const current = id ? batchesDb.get(id) : Array.from(batchesDb.values())[0];
                if (!current) return { data: null, error: null };
                if (filters["organization_id"] && current.organization_id !== filters["organization_id"]) {
                  return { data: null, error: null };
                }
                if (filters["status"] && current.status !== filters["status"]) {
                  return { data: null, error: null };
                }
                const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
                if (id) batchesDb.set(id, updated);
                return { data: updated, error: null };
              };
              const chain = {
                eq: (col: string, val: string) => {
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

        if (tabela === "vehicles") {
          return {
            select: () => ({
              eq: () => ({
                or: async () => ({ data: existing, error: null }),
                in: async () => ({ data: existing, error: null }),
              }),
            }),
            insert: async (chunk: Array<Record<string, unknown>>) => {
              if (options?.insertError) {
                return { error: { message: "Simulated insert failure on disk" } };
              }
              vehiclesDb.push(...chunk);
              return { error: null };
            },
            delete: () => ({
              eq: async (_col: string, val: string) => {
                vehiclesDb = vehiclesDb.filter((v) => v.import_batch_id !== val);
                return { error: null };
              },
            }),
          };
        }

        return {} as never;
      },
      rpc: async (fnName: string, params: Record<string, unknown>) => {
        if (fnName === "fn_confirm_vehicle_import") {
          if (options?.insertError) {
            return { data: null, error: { message: "Simulated database transaction rollback" } };
          }
          const batchId = params.p_batch_id as string;
          const orgId = params.p_org_id as string;
          const idempotencyKey = params.p_idempotency_key as string;
          const fileHash = params.p_file_hash as string;
          const vehicles = (params.p_vehicles as Array<Record<string, unknown>>) || [];
          const errors = (params.p_errors as Array<Record<string, unknown>>) || [];

          const batch = batchesDb.get(batchId);
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
              id: `veh-${vehiclesDb.length + 1}`,
              organization_id: orgId,
              import_batch_id: batchId,
              ...v,
            };
            inserted.push(record);
          }
          vehiclesDb.push(...inserted);

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
          batchesDb.set(batchId, updatedBatch);

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

  // ---------------------------------------------------------------------------
  // FASE 1: TESTES DE AUTORIZAÇÃO E SEGURANÇA
  // ---------------------------------------------------------------------------
  describe("1. Autorização e Nicho", () => {
    it("nega acesso com 401 se não autenticado", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: false,
        response: fail("unauthenticated", "Auth required", 401) as never,
      });

      const form = new FormData();
      form.append("file", new File(["marca,modelo\nFiat,Uno"], "teste.csv"));
      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(401);
    });

    it("FAIL-CLOSED: nega operação com 403 se a organização opera no nicho 'ecommerce'", async () => {
      vi.mocked(createClient).mockResolvedValueOnce(
        makeMockSupabase({ nicheId: "ecommerce" }) as never,
      );

      const form = new FormData();
      form.append("file", new File(["marca,modelo\nFiat,Uno"], "teste.csv"));
      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("forbidden_niche");
    });

    it("FAIL-CLOSED: nega operação com 403 se a organização não tem nicho configurado (null)", async () => {
      vi.mocked(createClient).mockResolvedValueOnce(
        makeMockSupabase({ nicheId: null }) as never,
      );

      const form = new FormData();
      form.append("file", new File(["marca,modelo\nFiat,Uno"], "teste.csv"));
      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("forbidden_niche");
    });
  });

  // ---------------------------------------------------------------------------
  // FASE 2: PRÉ-VISUALIZAÇÃO (PREVIEW)
  // ---------------------------------------------------------------------------
  describe("2. Pré-visualização (POST /preview)", () => {
    it("rejeita arquivo com extensão inválida (.pdf)", async () => {
      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const form = new FormData();
      form.append("file", new File(["documento"], "tabela.pdf", { type: "application/pdf" }));
      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.message).toMatch(/Formato não suportado/);
    });

    it("processa planilha CSV válida com pré-visualização sanitizada e sem efeitos colaterais", async () => {
      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const csvContent =
        "Marca,Modelo,Versão,Ano,Km,Preço,Cor,Câmbio,Combustível,Placa,Chassi,Custo\n" +
        "Toyota,Corolla,XEi 2.0,2022/2023,35000,128900.00,Prata,CVT,Flex,ABC1D23,9BWZZZ377VT004251,105000\n" +
        "Honda,Civic,Touring,2021,42000,149000,Preto,Automático,Gasolina,DEF4E56,9BWZZZ377VT009999,120000\n";

      const form = new FormData();
      form.append("file", new File([csvContent], "estoque.csv", { type: "text/csv" }));

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.resumo.total_linhas).toBe(2);
      expect(json.data.resumo.validos_count).toBe(2);
      expect(json.data.resumo.erros_count).toBe(0);
      expect(json.data.batch_id).toBeDefined();

      // NÃO houve inserção em vehicles na pré-visualização
      expect(vehiclesDb.length).toBe(0);

      // Lote criado em status 'preview'
      const batchCriado = batchesDb.get(json.data.batch_id);
      expect(batchCriado?.status).toBe("preview");
      expect(batchCriado?.imported_count).toBe(0);

      // Verificação estrita de ausência de campos confidenciais na resposta
      const amostra = json.data.amostra_veiculos[0];
      expect(amostra.marca).toBe("Toyota");
      expect(amostra.modelo).toBe("Corolla");
      expect(amostra.preco_cents).toBe(12890000);
      expect(amostra.placa_final).toBe("3");
      expect(amostra.placa_mascarada).toBe("ABC***3");
      expect(amostra.chassi_mascarado).toBe("9BW**********4251");

      // Campos confidenciais estritamente ausentes
      expect(amostra.placa_completa).toBeUndefined();
      expect(amostra.chassi).toBeUndefined();
      expect(amostra.custo_aquisicao_cents).toBeUndefined();
      expect(amostra.observacoes_internas).toBeUndefined();

      // Auditoria emitida
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vehicles.import_previewed",
          resourceId: json.data.batch_id,
        }),
      );
    });

    it("detecta duplicidades internas na planilha e contra o estoque existente no banco", async () => {
      // Simula que o Corolla com chassi '9BWZZZ377VT004251' já existe no banco
      const supabaseMock = makeMockSupabase({
        nicheId: "vehicles",
        existingVehicles: [
          { id: "v-existente", chassi: "9BWZZZ377VT004251", placa_completa: "ABC1D23" },
        ],
      });
      vi.mocked(createClient).mockResolvedValue(supabaseMock as never);

      const csvContent =
        "Marca,Modelo,Ano,Preço,Placa,Chassi\n" +
        // Linha 2: Conflito com banco (chassi já cadastrado)
        "Toyota,Corolla,2022,120000,ABC1D23,9BWZZZ377VT004251\n" +
        // Linha 3: Válido
        "Fiat,Pulse,2023,95000,GHJ7H89,9BWZZZ377VT008888\n" +
        // Linha 4: Duplicata interna da linha 3 (mesmo chassi da linha 3)
        "Fiat,Pulse Drive,2023,98000,KLM9K12,9BWZZZ377VT008888\n";

      const form = new FormData();
      form.append("file", new File([csvContent], "duplicatas.csv", { type: "text/csv" }));

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.resumo.total_linhas).toBe(3);
      expect(json.data.resumo.validos_count).toBe(1); // Apenas o Fiat Pulse da linha 3
      expect(json.data.resumo.duplicatas_planilha_count).toBe(1); // Linha 4 (duplicata interna)
      expect(json.data.resumo.duplicatas_estoque_count).toBe(1);  // Linha 2 (conflito de estoque)
      expect(json.data.duplicatas.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // FASE 3: CONFIRMAÇÃO TRANSACIONAL & IDEMPOTÊNCIA
  // ---------------------------------------------------------------------------
  describe("3. Confirmação (POST /confirm)", () => {
    it("rejeita confirmação se idempotency_key for muito curta (< 8 chars)", async () => {
      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const form = new FormData();
      form.append("file", new File(["conteudo"], "estoque.csv"));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "123");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.message).toMatch(/idempotency_key/);
    });

    it("rejeita confirmação com 422 se o arquivo foi alterado após a pré-visualização (file_hash_mismatch)", async () => {
      // Registra o lote no mock com hash do conteúdo original
      const hashOriginal = createHash("sha256").update(Buffer.from("conteudo original")).digest("hex");
      batchesDb.set(BATCH_ID, {
        id: BATCH_ID,
        organization_id: ORG_ID,
        filename: "estoque.csv",
        file_hash: hashOriginal,
        status: "preview",
        total_rows: 1,
        metadata: {},
      });

      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      // Envia arquivo adulterado / diferente
      const form = new FormData();
      form.append("file", new File(["conteudo ADULTERADO"], "estoque.csv"));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "idem-uuid-12345");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("file_hash_mismatch");
      expect(vehiclesDb.length).toBe(0);
    });

    it("confirma o lote com persistência atômica e registra status 'completed'", async () => {
      const csvContent =
        "Marca,Modelo,Versão,Ano,Km,Preço,Cor,Câmbio,Combustível,Placa,Chassi\n" +
        "Volkswagen,Nivus,Highline,2022,28000,119000,Cinza,Automático,Flex,XYZ9W88,9BWZZZ377VT001122\n";

      const hash = createHash("sha256").update(Buffer.from(csvContent)).digest("hex");
      batchesDb.set(BATCH_ID, {
        id: BATCH_ID,
        organization_id: ORG_ID,
        filename: "nivus.csv",
        file_hash: hash,
        status: "preview",
        total_rows: 1,
        metadata: {},
      });

      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const form = new FormData();
      form.append("file", new File([csvContent], "nivus.csv", { type: "text/csv" }));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "idem-key-abc-123456");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.status).toBe("completed");
      expect(json.data.imported_count).toBe(1);
      expect(json.data.idempotency_replayed).toBe(false);

      // Veículo persistido no banco
      expect(vehiclesDb.length).toBe(1);
      const v = vehiclesDb[0]!;
      expect(v.marca).toBe("Volkswagen");
      expect(v.modelo).toBe("Nivus");
      expect(v.preco_cents).toBe(11900000);
      expect(v.import_batch_id).toBe(BATCH_ID);

      // Lote atualizado para completed com a chave de idempotência
      const batchAtualizado = batchesDb.get(BATCH_ID);
      expect(batchAtualizado?.status).toBe("completed");
      expect((batchAtualizado?.metadata as Record<string, unknown>)?.idempotency_key).toBe("idem-key-abc-123456");

      // Auditoria emitida
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vehicles.import_confirmed",
          resourceId: BATCH_ID,
        }),
      );
    });

    it("IDEMPOTÊNCIA: chamada repetida com a mesma chave devolve 200 OK sem duplicar veículos", async () => {
      const csvContent = "Marca,Modelo\nChevrolet,Onix\n";
      const hash = createHash("sha256").update(Buffer.from(csvContent)).digest("hex");

      // Lote já concluído com a chave 'chave-idempotente-999'
      batchesDb.set(BATCH_ID, {
        id: BATCH_ID,
        organization_id: ORG_ID,
        filename: "onix.csv",
        file_hash: hash,
        status: "completed",
        total_rows: 1,
        imported_count: 1,
        duplicate_count: 0,
        error_count: 0,
        confirmed_at: "2026-10-23T04:00:00.000Z",
        metadata: { idempotency_key: "chave-idempotente-999" },
      });
      // Um veículo já persistido
      vehiclesDb.push({ id: "v1", import_batch_id: BATCH_ID, modelo: "Onix" });

      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const form = new FormData();
      form.append("file", new File([csvContent], "onix.csv", { type: "text/csv" }));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "chave-idempotente-999");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.status).toBe("completed");
      expect(json.data.idempotency_replayed).toBe(true);
      expect(json.data.imported_count).toBe(1);

      // Quantidade de veículos continua exatamente 1 (não duplicou)
      expect(vehiclesDb.length).toBe(1);
    });

    it("rejeita com 409 se lote já foi confirmado com chave diferente", async () => {
      batchesDb.set(BATCH_ID, {
        id: BATCH_ID,
        organization_id: ORG_ID,
        filename: "onix.csv",
        status: "completed",
        metadata: { idempotency_key: "chave-anterior-111" },
      });

      vi.mocked(createClient).mockResolvedValue(makeMockSupabase({ nicheId: "vehicles" }) as never);

      const form = new FormData();
      form.append("file", new File(["Marca,Modelo\nChevrolet,Onix\n"], "onix.csv"));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "chave-nova-diferente-222");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("batch_already_confirmed");
    });

    it("ROLLBACK TRANSACIONAL: falha de inserção limpa registros parciais e marca lote como 'failed'", async () => {
      const csvContent = "Marca,Modelo\nFord,Ka\n";
      const hash = createHash("sha256").update(Buffer.from(csvContent)).digest("hex");

      batchesDb.set(BATCH_ID, {
        id: BATCH_ID,
        organization_id: ORG_ID,
        filename: "ka.csv",
        file_hash: hash,
        status: "preview",
        total_rows: 1,
        metadata: {},
      });

      // Configura falha simulada na RPC transacional
      const mockSupabaseComErro = makeMockSupabase({ nicheId: "vehicles", insertError: true });
      vi.mocked(createClient).mockResolvedValue(mockSupabaseComErro as never);
      vi.mocked(createAdminClient).mockReturnValue(mockSupabaseComErro as never);

      const form = new FormData();
      form.append("file", new File([csvContent], "ka.csv", { type: "text/csv" }));
      form.append("batch_id", BATCH_ID);
      form.append("idempotency_key", "chave-falha-12345");

      const req = new NextRequest("http://localhost/api/v1/vehicles/import/confirm", {
        method: "POST",
        body: form,
      });

      const res = await confirmHandler(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("persistence_failed");

      // Nenhum veículo parcial sobreviveu (rollback total)
      expect(vehiclesDb.length).toBe(0);

      // Status do lote não foi completado
      const batchFalho = batchesDb.get(BATCH_ID);
      expect(batchFalho?.status).not.toBe("completed");
    });
  });
});
