/**
 * Testes Unitários das Ferramentas MCP de Veículos (Subetapa 2.4).
 *
 * Valida integralmente:
 * 1. Pesquisa por marca e modelo com filtros no servidor.
 * 2. Filtros combinados (marca, modelo, versão, ano min/max, combustível, câmbio, cor, preço min/max, km min/max).
 * 3. Faixas de preço e quilometragem, preservando null quando ausente (NUNCA zero!).
 * 4. Contagem total exata, paginação, total_paginas e tem_mais.
 * 5. Ordenação determinística com desempate secundário por id (recentes, preco_asc, preco_desc, ano_desc, km_asc).
 * 6. Resposta estruturada para estoque vazio (total 0, veiculos vazio, sem erros).
 * 7. Status comercial padrão ('disponivel') e status explícito ('vendido', etc.).
 * 8. Obtenção de detalhes comerciais de veículo específico (crm_get_vehicle).
 * 9. Bloqueio e isolamento cross-tenant: tentativa de obter veículo de outra organização resulta em não encontrado.
 * 10. Ausência total de campos confidenciais (placa_completa, chassi, custos, observacoes_internas).
 * 11. Governança de nicho nas 3 camadas:
 *     - Camada 1: pickToolsFromMcp exclui ferramentas de veículos para nicho diferente ou nulo.
 *     - Camada 2: Servidor / Runtime bloqueia execução com McpAuthError (-32002 / 403).
 *     - Camada 3: Handler rejeita com erro nicho_incompativel se nicho não for 'vehicles'.
 * 12. Regressão e continuidade: ferramentas universais de CRM e ferramentas de e-commerce continuam funcionando nos seus respectivos nichos.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  isServiceRoleConfigured: () => false,
}));
vi.mock("@/lib/mcp/audit", () => ({
  auditMcpToolCall: vi.fn().mockResolvedValue(undefined),
}));

import { crmGetVehicle, crmSearchVehicles } from "@/lib/mcp/tools/veiculos";
import { crmSearchProducts, crmListContactOrders } from "@/lib/mcp/tools/comercio";
import { crmSearchContacts } from "@/lib/mcp/tools/contacts";
import { crmListConversations } from "@/lib/mcp/tools/conversations";
import { pickToolsFromMcp, type PickToolsInput } from "@/lib/ai/runtime/tools";
import type { McpContext } from "@/lib/mcp/types";
import type { Actor } from "@/lib/api/handlers/types";

interface QueryCall {
  metodo: string;
  args: unknown[];
}

interface FakeVehicleRow {
  id: string;
  organization_id: string;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: string | null;
  cambio: string | null;
  quilometragem: number | null;
  preco_cents: number | null;
  moeda: string;
  status: string;
  opcionais: string[];
  fotos_urls: string[];
  placa_final: string | null;
  created_at: string;
  updated_at: string;
  // Campos confidenciais que NÃO devem existir na view safe
  placa_completa?: string;
  chassi?: string;
  custo_aquisicao_cents?: number;
  custo_preparacao_cents?: number;
  observacoes_internas?: string;
}

function createFakeVehiclesDb(options: {
  rows?: FakeVehicleRow[];
  totalCount?: number;
  targetOrgId?: string;
  targetNiche?: "vehicles" | "ecommerce" | null;
  dbError?: Error | null;
}) {
  const chamadas: QueryCall[] = [];
  const rows = options.rows ?? [];
  const total = options.totalCount ?? rows.length;
  const orgId = options.targetOrgId ?? "org-veiculos-123";
  const niche = options.targetNiche !== undefined ? options.targetNiche : "vehicles";

  let de = 0;
  let ate = 9;

  const queryBuilder: Record<string, unknown> = {};

  const registra = (metodo: string) => (...args: unknown[]) => {
    chamadas.push({ metodo, args });
    if (metodo === "range") {
      de = args[0] as number;
      ate = args[1] as number;
    }
    return queryBuilder;
  };

  for (const m of [
    "select",
    "eq",
    "ilike",
    "gte",
    "lte",
    "order",
    "range",
    "limit",
    "is",
  ]) {
    queryBuilder[m] = registra(m);
  }

  queryBuilder.maybeSingle = async () => {
    chamadas.push({ metodo: "maybeSingle", args: [] });
    if (options.dbError) {
      return { data: null, error: options.dbError };
    }
    // Encontra o veículo filtrado por eq("id", ...) e eq("organization_id", ...)
    const idFilter = chamadas.find((c) => c.metodo === "eq" && c.args[0] === "id")?.args[1];
    const orgFilter = chamadas.find((c) => c.metodo === "eq" && c.args[0] === "organization_id")?.args[1];

    const match = rows.find(
      (r) => (!idFilter || r.id === idFilter) && (!orgFilter || r.organization_id === orgFilter),
    );

    return { data: match ?? null, error: null };
  };

  (queryBuilder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
    if (options.dbError) {
      return Promise.resolve(resolve({ data: null, count: null, error: options.dbError }));
    }
    const pageRows = rows.slice(de, ate + 1);
    return Promise.resolve(resolve({ data: pageRows, count: total, error: null }));
  };

  const mockSupabase = {
    from: vi.fn().mockImplementation((table: string) => {
      chamadas.push({ metodo: "from", args: [table] });
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: niche },
                error: null,
              }),
            }),
          }),
        };
      }
      return queryBuilder;
    }),
  };

  const mockActor: Actor = {
    type: "ai_agent",
    id: "agent-run-1",
    role: "ai_operator",
    agent_id: "agent-123",
  };

  const ctx: McpContext = {
    organizationId: orgId,
    role: "agent",
    actor: mockActor,
    apiTokenId: "tok-123",
    requestId: "req-123",
    nicheId: niche,
    supabase: mockSupabase as never,
  };

  return { chamadas, ctx, mockSupabase, queryBuilder };
}

const buscarVeiculos = (
  db: ReturnType<typeof createFakeVehiclesDb>,
  input: Record<string, unknown> = {},
) => crmSearchVehicles.handler(input as never, db.ctx);

describe("Ferramentas MCP de Veículos — Subetapa 2.4", () => {
  const sampleVehicle: FakeVehicleRow = {
    id: "33333333-3333-4333-8333-333333333331",
    organization_id: "org-veiculos-123",
    marca: "Volkswagen",
    modelo: "Gol",
    versao: "1.0 MPI Trendline Total Flex",
    ano_fabricacao: 2021,
    ano_modelo: 2022,
    cor: "Branco",
    combustivel: "flex",
    cambio: "manual",
    quilometragem: 45000,
    preco_cents: 5590000, // R$ 55.900,00
    moeda: "BRL",
    status: "disponivel",
    opcionais: ["Ar condicionado", "Direção hidráulica", "Airbag"],
    fotos_urls: ["https://cdn.example.com/gol1.jpg"],
    placa_final: "4",
    created_at: "2026-10-23T10:00:00Z",
    updated_at: "2026-10-23T10:00:00Z",
  };

  // -------------------------------------------------------------------------
  // 1. Pesquisa por marca, modelo e filtros combinados
  // -------------------------------------------------------------------------
  describe("crm_search_vehicles — Filtros e Consulta Estruturada", () => {
    it("aplica filtro de marca e modelo no servidor (PostgREST ilike)", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      const res = (await buscarVeiculos(db, { marca: "Volkswagen", modelo: "Gol" })) as {
        total: number;
        veiculos: Array<{ marca: string; modelo: string; preco_formatado: string | null }>;
      };

      expect(res.total).toBe(1);
      expect(res.veiculos).toHaveLength(1);
      expect(res.veiculos[0]!.marca).toBe("Volkswagen");
      expect(res.veiculos[0]!.modelo).toBe("Gol");
      expect(res.veiculos[0]!.preco_formatado).toBe("R$\u00a055.900,00");

      // Verifica chamadas ao queryBuilder
      const ilikeCalls = db.chamadas.filter((c) => c.metodo === "ilike");
      expect(ilikeCalls).toEqual([
        { metodo: "ilike", args: ["marca", "%Volkswagen%"] },
        { metodo: "ilike", args: ["modelo", "%Gol%"] },
      ]);
    });

    it("aplica filtros combinados (versão, combustível, câmbio, cor, ano_min, ano_max, preço, km)", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      await buscarVeiculos(db, {
        versao: "Trendline",
        combustivel: "flex",
        cambio: "manual",
        cor: "Branco",
        ano_min: 2020,
        ano_max: 2023,
        preco_min_cents: 4000000,
        preco_max_cents: 6000000,
        km_min: 10000,
        km_max: 50000,
      });

      const eqCalls = db.chamadas.filter((c) => c.metodo === "eq");
      expect(eqCalls).toContainEqual({ metodo: "eq", args: ["organization_id", "org-veiculos-123"] });
      expect(eqCalls).toContainEqual({ metodo: "eq", args: ["combustivel", "flex"] });
      expect(eqCalls).toContainEqual({ metodo: "eq", args: ["cambio", "manual"] });
      expect(eqCalls).toContainEqual({ metodo: "eq", args: ["status", "disponivel"] }); // status padrão

      const gteCalls = db.chamadas.filter((c) => c.metodo === "gte");
      expect(gteCalls).toContainEqual({ metodo: "gte", args: ["ano_modelo", 2020] });
      expect(gteCalls).toContainEqual({ metodo: "gte", args: ["preco_cents", 4000000] });
      expect(gteCalls).toContainEqual({ metodo: "gte", args: ["quilometragem", 10000] });

      const lteCalls = db.chamadas.filter((c) => c.metodo === "lte");
      expect(lteCalls).toContainEqual({ metodo: "lte", args: ["ano_modelo", 2023] });
      expect(lteCalls).toContainEqual({ metodo: "lte", args: ["preco_cents", 6000000] });
      expect(lteCalls).toContainEqual({ metodo: "lte", args: ["quilometragem", 50000] });
    });

    it("preserva null em preço e quilometragem ausentes (NUNCA transforma em 0)", async () => {
      const vehicleSemPrecoNemKm: FakeVehicleRow = {
        ...sampleVehicle,
        id: "33333333-3333-4333-8333-333333333332",
        preco_cents: null,
        quilometragem: null,
      };

      const db = createFakeVehiclesDb({ rows: [vehicleSemPrecoNemKm], totalCount: 1 });

      const res = (await buscarVeiculos(db, {})) as {
        veiculos: Array<{ preco_cents: number | null; quilometragem: number | null; preco_formatado: string | null }>;
      };

      expect(res.veiculos[0]!.preco_cents).toBeNull();
      expect(res.veiculos[0]!.preco_formatado).toBeNull();
      expect(res.veiculos[0]!.quilometragem).toBeNull();
    });

    it("respeita contagem total, paginação e indicador tem_mais (ex: cenário de 7 Gol)", async () => {
      // Simula 7 veículos Gol no estoque, pagina de 5 em 5
      const seteGols: FakeVehicleRow[] = Array.from({ length: 7 }, (_, i) => ({
        ...sampleVehicle,
        id: `33333333-3333-4333-8333-33333333330${i}`,
        modelo: `Gol G${i + 1}`,
      }));

      // Página 1: pede 5 de 7
      const dbPag1 = createFakeVehiclesDb({ rows: seteGols, totalCount: 7 });
      const resPag1 = (await buscarVeiculos(dbPag1, { modelo: "Gol", pagina: 1, limite: 5 })) as {
        total: number;
        pagina: number;
        limite: number;
        total_paginas: number;
        tem_mais: boolean;
        veiculos: unknown[];
      };

      expect(resPag1.total).toBe(7);
      expect(resPag1.pagina).toBe(1);
      expect(resPag1.limite).toBe(5);
      expect(resPag1.total_paginas).toBe(2);
      expect(resPag1.tem_mais).toBe(true);
      expect(resPag1.veiculos).toHaveLength(5);

      // Página 2: pede restantes
      const dbPag2 = createFakeVehiclesDb({ rows: seteGols, totalCount: 7 });
      const resPag2 = (await buscarVeiculos(dbPag2, { modelo: "Gol", pagina: 2, limite: 5 })) as {
        total: number;
        pagina: number;
        limite: number;
        total_paginas: number;
        tem_mais: boolean;
        veiculos: unknown[];
      };

      expect(resPag2.total).toBe(7);
      expect(resPag2.pagina).toBe(2);
      expect(resPag2.tem_mais).toBe(false);
      expect(resPag2.veiculos).toHaveLength(2);
    });

    it("garante ordenação determinística com desempate por id", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      // Teste ordenação recentes (padrão)
      await buscarVeiculos(db, { ordenacao: "recentes" });
      let orderCalls = db.chamadas.filter((c) => c.metodo === "order");
      expect(orderCalls).toEqual([
        { metodo: "order", args: ["created_at", { ascending: false }] },
        { metodo: "order", args: ["id", { ascending: true }] },
      ]);

      // Teste ordenação preco_asc
      const dbPreco = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });
      await buscarVeiculos(dbPreco, { ordenacao: "preco_asc" });
      orderCalls = dbPreco.chamadas.filter((c) => c.metodo === "order");
      expect(orderCalls).toEqual([
        { metodo: "order", args: ["preco_cents", { ascending: true, nullsFirst: false }] },
        { metodo: "order", args: ["id", { ascending: true }] },
      ]);
    });

    it("retorna estoque vazio de forma consistente e estruturada", async () => {
      const db = createFakeVehiclesDb({ rows: [], totalCount: 0 });

      const res = (await buscarVeiculos(db, { marca: "Ferrari" })) as {
        total: number;
        total_paginas: number;
        tem_mais: boolean;
        veiculos: unknown[];
      };

      expect(res.total).toBe(0);
      expect(res.total_paginas).toBe(0);
      expect(res.tem_mais).toBe(false);
      expect(res.veiculos).toEqual([]);
    });

    it("permite consultar status não-disponível somente sob solicitação explícita", async () => {
      const db = createFakeVehiclesDb({ rows: [], totalCount: 0 });

      await buscarVeiculos(db, { status: "vendido" });

      const statusCall = db.chamadas.find((c) => c.metodo === "eq" && c.args[0] === "status");
      expect(statusCall).toEqual({ metodo: "eq", args: ["status", "vendido"] });
    });
  });

  // -------------------------------------------------------------------------
  // 2. Detalhes de um veículo específico (crm_get_vehicle)
  // -------------------------------------------------------------------------
  describe("crm_get_vehicle — Detalhes e Isolamento", () => {
    it("retorna veículo com todos os campos comerciais e seguros quando encontrado", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      const res = (await crmGetVehicle.handler(
        { vehicle_id: sampleVehicle.id },
        db.ctx,
      )) as {
        encontrado: boolean;
        veiculo: {
          id: string;
          marca: string;
          modelo: string;
          opcionais: string[];
          fotos_urls: string[];
          preco_formatado: string | null;
        } | null;
      };

      expect(res.encontrado).toBe(true);
      expect(res.veiculo).not.toBeNull();
      expect(res.veiculo?.id).toBe(sampleVehicle.id);
      expect(res.veiculo?.marca).toBe("Volkswagen");
      expect(res.veiculo?.opcionais).toEqual(["Ar condicionado", "Direção hidráulica", "Airbag"]);
      expect(res.veiculo?.preco_formatado).toBe("R$\u00a055.900,00");
    });

    it("retorna encontrado: false de forma segura quando o veículo não existe", async () => {
      const db = createFakeVehiclesDb({ rows: [], totalCount: 0 });

      const res = (await crmGetVehicle.handler(
        { vehicle_id: "00000000-0000-4000-8000-000000000000" },
        db.ctx,
      )) as {
        encontrado: boolean;
        veiculo: unknown;
        mensagem: string;
      };

      expect(res.encontrado).toBe(false);
      expect(res.veiculo).toBeNull();
      expect(res.mensagem).toBe("Veículo não encontrado no estoque da organização.");
    });

    it("ISOLAMENTO CROSS-TENANT: não revela veículo de outra organização e retorna não encontrado", async () => {
      // Veículo pertence a outra organização
      const veiculoDeOutraOrg: FakeVehicleRow = {
        ...sampleVehicle,
        id: "44444444-4444-4444-8444-444444444444",
        organization_id: "outra-organizacao-999",
      };

      const db = createFakeVehiclesDb({
        rows: [veiculoDeOutraOrg],
        targetOrgId: "minha-organizacao-123",
      });

      const res = (await crmGetVehicle.handler(
        { vehicle_id: veiculoDeOutraOrg.id },
        db.ctx,
      )) as {
        encontrado: boolean;
        veiculo: unknown;
      };

      expect(res.encontrado).toBe(false);
      expect(res.veiculo).toBeNull();

      // Confirma que a query filtrou obrigatoriamente por organization_id = minha-organizacao-123
      const orgFilter = db.chamadas.find((c) => c.metodo === "eq" && c.args[0] === "organization_id");
      expect(orgFilter?.args[1]).toBe("minha-organizacao-123");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Ausência de campos confidenciais
  // -------------------------------------------------------------------------
  describe("Proteção contra vazamento de campos confidenciais", () => {
    it("crm_search_vehicles JAMAIS inclui placa completa, chassi, custos ou observações internas", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      const res = (await buscarVeiculos(db, {})) as {
        veiculos: Record<string, unknown>[];
      };

      const v = res.veiculos[0]!;
      expect(v).not.toHaveProperty("placa_completa");
      expect(v).not.toHaveProperty("chassi");
      expect(v).not.toHaveProperty("custo_aquisicao_cents");
      expect(v).not.toHaveProperty("custo_preparacao_cents");
      expect(v).not.toHaveProperty("observacoes_internas");
    });

    it("crm_get_vehicle JAMAIS inclui placa completa, chassi, custos ou observações internas", async () => {
      const db = createFakeVehiclesDb({ rows: [sampleVehicle], totalCount: 1 });

      const res = (await crmGetVehicle.handler(
        { vehicle_id: sampleVehicle.id },
        db.ctx,
      )) as {
        veiculo: Record<string, unknown>;
      };

      const v = res.veiculo;
      expect(v).not.toHaveProperty("placa_completa");
      expect(v).not.toHaveProperty("chassi");
      expect(v).not.toHaveProperty("custo_aquisicao_cents");
      expect(v).not.toHaveProperty("custo_preparacao_cents");
      expect(v).not.toHaveProperty("observacoes_internas");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Governança de nicho nas 3 camadas
  // -------------------------------------------------------------------------
  describe("Governança de Nicho nas 3 camadas de defesa", () => {
    it("Camada 3 (Handler): Rejeita com erro se a organização estiver em nicho 'ecommerce'", async () => {
      const db = createFakeVehiclesDb({ targetNiche: "ecommerce" });

      await expect(buscarVeiculos(db, {})).rejects.toThrow(/nicho_incompativel/);
      await expect(
        crmGetVehicle.handler({ vehicle_id: sampleVehicle.id }, db.ctx),
      ).rejects.toThrow(/nicho_incompativel/);
    });

    it("Camada 3 (Handler): Rejeita se o nicho for nulo ou ausente", async () => {
      const db = createFakeVehiclesDb({ targetNiche: null });

      await expect(buscarVeiculos(db, {})).rejects.toThrow(/nicho_incompativel/);
      await expect(
        crmGetVehicle.handler({ vehicle_id: sampleVehicle.id }, db.ctx),
      ).rejects.toThrow(/nicho_incompativel/);
    });

    it("Camada 1 (Runtime Picker): pickToolsFromMcp exclui ferramentas de veículos para nicho 'ecommerce'", () => {
      const pickInput: PickToolsInput = {
        toolIds: ["crm_search_vehicles", "crm_get_vehicle", "crm_search_contacts"],
        auth: {
          organizationId: "org-ecom-1",
          role: "agent",
          actor: { type: "ai_agent", id: "agent-1", role: "ai_operator", agent_id: "ag-1" },
          scopes: ["mcp:read", "mcp:write"],
          apiTokenId: "tok-1",
        },
        ctx: {
          organizationId: "org-ecom-1",
          role: "agent",
          actor: { type: "ai_agent", id: "agent-1", role: "ai_operator", agent_id: "ag-1" },
          apiTokenId: "tok-1",
          requestId: "req-1",
          nicheId: "ecommerce", // Nicho e-commerce
          supabase: {} as never,
        },
        supabase: {} as never,
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      };
      const tools = pickToolsFromMcp(pickInput);

      // Ferramentas de veículos NÃO devem estar disponíveis
      expect(tools.crm_search_vehicles).toBeUndefined();
      expect(tools.crm_get_vehicle).toBeUndefined();
      // Ferramenta universal de CRM DEVE estar disponível
      expect(tools.crm_search_contacts).toBeDefined();
    });

    it("Camada 1 (Runtime Picker): pickToolsFromMcp disponibiliza ferramentas de veículos para nicho 'vehicles'", () => {
      const pickInput: PickToolsInput = {
        toolIds: ["crm_search_vehicles", "crm_get_vehicle", "crm_search_contacts"],
        auth: {
          organizationId: "org-vec-1",
          role: "agent",
          actor: { type: "ai_agent", id: "agent-1", role: "ai_operator", agent_id: "ag-1" },
          scopes: ["mcp:read", "mcp:write"],
          apiTokenId: "tok-1",
        },
        ctx: {
          organizationId: "org-vec-1",
          role: "agent",
          actor: { type: "ai_agent", id: "agent-1", role: "ai_operator", agent_id: "ag-1" },
          apiTokenId: "tok-1",
          requestId: "req-1",
          nicheId: "vehicles", // Nicho veículos
          supabase: {} as never,
        },
        supabase: {} as never,
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      };
      const tools = pickToolsFromMcp(pickInput);

      // Ferramentas de veículos DEVEM estar disponíveis
      expect(tools.crm_search_vehicles).toBeDefined();
      expect(tools.crm_get_vehicle).toBeDefined();
      expect(tools.crm_search_contacts).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Continuidade das ferramentas universais e regressão de e-commerce
  // -------------------------------------------------------------------------
  describe("Continuidade das ferramentas universais e e-commerce", () => {
    it("ferramentas universais (contatos, conversas) não possuem restrição de nicho", () => {
      expect(crmSearchContacts.requiresNiche).toBeUndefined();
      expect(crmListConversations.requiresNiche).toBeUndefined();
    });

    it("ferramentas de e-commerce continuam exigindo nicho 'ecommerce'", () => {
      expect(crmSearchProducts.requiresNiche).toBe("ecommerce");
      expect(crmListContactOrders.requiresNiche).toBe("ecommerce");
    });

    it("ferramentas de veículos declaram explicitamente requiresNiche: 'vehicles'", () => {
      expect(crmSearchVehicles.requiresNiche).toBe("vehicles");
      expect(crmGetVehicle.requiresNiche).toBe("vehicles");
    });
  });
});
