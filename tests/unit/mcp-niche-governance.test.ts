/**
 * Governança de Nichos no MCP e Runtime (Fase B).
 *
 * Valida a arquitetura multi-camadas de isolamento por nicho de negócio:
 * 1. Resolução estrita e fail-closed (resolveOrganizationNiche nunca assume default quando não resolvido).
 * 2. Declaração explícita de nicho nas ferramentas especializadas (requiresNiche: 'ecommerce' | 'vehicles').
 * 3. Exclusão proativa na seleção de ferramentas do runtime (pickToolsFromMcp).
 * 4. Bloqueio no servidor MCP antes da execução do handler (createMcpServer).
 * 5. Validação defensiva no handler do servidor (defense-in-depth).
 * 6. Disponibilidade incondicional de ferramentas universais de CRM.
 */
import { describe, expect, it, vi } from "vitest";

// Mocks para evitar dependências externas
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

import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { crmListContactOrders, crmSearchProducts } from "@/lib/mcp/tools/comercio";
import { crmSearchContacts } from "@/lib/mcp/tools/contacts";
import { crmListConversations } from "@/lib/mcp/tools/conversations";
import { crmListPrivacyRequests } from "@/lib/mcp/tools/privacidade";
import { TOOLS_COMERCIO } from "@/lib/mcp/tools/catalogo/comercio";
import { pickToolsFromMcp, type PickToolsInput } from "@/lib/ai/runtime/tools";
import type { McpAuthResult } from "@/lib/mcp/auth";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";
import type { Actor } from "@/lib/api/handlers/types";
import { z } from "zod";

describe("Governança de Nichos no MCP e Runtime", () => {
  const ORG_ECOMMERCE = "11111111-1111-4111-8111-111111111111";
  const ORG_VEHICLES = "22222222-2222-4222-8222-222222222222";
  const ORG_SEM_NICHO = "33333333-3333-4333-8333-333333333333";

  const mockActor: Actor = {
    type: "ai_agent",
    id: "run-1",
    role: "ai_operator",
    agent_id: "agent-1",
  };

  // -------------------------------------------------------------------------
  // 1. Resolução estrita do nicho (fail-closed)
  // -------------------------------------------------------------------------
  describe("1. Resolução estrita de nicho (resolveOrganizationNiche)", () => {
    it("resolve 'ecommerce' corretamente para organização de comércio", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: "ecommerce" },
                error: null,
              }),
            }),
          }),
        }),
      };

      const niche = await resolveOrganizationNiche(mockSupabase as never, ORG_ECOMMERCE);
      expect(niche).toBe("ecommerce");
    });

    it("resolve 'vehicles' corretamente para concessionária / loja de veículos", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: "vehicles" },
                error: null,
              }),
            }),
          }),
        }),
      };

      const niche = await resolveOrganizationNiche(mockSupabase as never, ORG_VEHICLES);
      expect(niche).toBe("vehicles");
    });

    it("FAIL-CLOSED: retorna null quando a organização não tem niche_id (NUNCA assume ecommerce)", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: null },
                error: null,
              }),
            }),
          }),
        }),
      };

      const niche = await resolveOrganizationNiche(mockSupabase as never, ORG_SEM_NICHO);
      expect(niche).toBeNull();
    });

    it("FAIL-CLOSED: retorna null quando niche_id é inválido/desconhecido", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: "nicho_fantasma" },
                error: null,
              }),
            }),
          }),
        }),
      };

      const niche = await resolveOrganizationNiche(mockSupabase as never, "org-qualquer");
      expect(niche).toBeNull();
    });

    it("FAIL-CLOSED: retorna null em caso de erro de consulta no banco", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection refused" },
              }),
            }),
          }),
        }),
      };

      const niche = await resolveOrganizationNiche(mockSupabase as never, ORG_ECOMMERCE);
      expect(niche).toBeNull();
    });

    it("FAIL-CLOSED: retorna null quando organizationId é vazio", async () => {
      const mockSupabase = { from: vi.fn() };
      const niche = await resolveOrganizationNiche(mockSupabase as never, "");
      expect(niche).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Declaração explícita de nicho
  // -------------------------------------------------------------------------
  describe("2. Declarações de nicho nas ferramentas", () => {
    it("ferramentas de e-commerce declaram requiresNiche: 'ecommerce'", () => {
      expect(crmListContactOrders.requiresNiche).toBe("ecommerce");
      expect(crmSearchProducts.requiresNiche).toBe("ecommerce");
    });

    it("entradas do catálogo de comércio refletem requiresNiche: 'ecommerce'", () => {
      const ordersEntry = TOOLS_COMERCIO.find((t) => t.name === "crm_list_contact_orders");
      const productsEntry = TOOLS_COMERCIO.find((t) => t.name === "crm_search_products");
      const privacyEntry = TOOLS_COMERCIO.find((t) => t.name === "crm_list_privacy_requests");

      expect(ordersEntry?.requiresNiche).toBe("ecommerce");
      expect(productsEntry?.requiresNiche).toBe("ecommerce");
      expect(privacyEntry?.requiresNiche).toBeUndefined(); // Universal
    });

    it("ferramentas universais não possuem restrição de nicho (requiresNiche = undefined)", () => {
      expect(crmSearchContacts.requiresNiche).toBeUndefined();
      expect(crmListConversations.requiresNiche).toBeUndefined();
      expect(crmListPrivacyRequests.requiresNiche).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Seleção proativa no Runtime (pickToolsFromMcp)
  // -------------------------------------------------------------------------
  describe("3. Seleção de ferramentas no Runtime (pickToolsFromMcp)", () => {
    function makeInput(nicheId: "ecommerce" | "vehicles" | null | undefined, toolIds: string[]): PickToolsInput {
      const ctx: McpContext = {
        organizationId: "org-test",
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        requestId: "req-1",
        nicheId,
        supabase: {} as never,
      };
      const auth: McpAuthResult = {
        organizationId: "org-test",
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        scopes: ["mcp:read", "mcp:write"],
      };
      return {
        supabase: {} as never,
        ctx,
        auth,
        toolIds,
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      };
    }

    it("organização 'ecommerce' recebe ferramentas de e-commerce e universais", () => {
      const input = makeInput("ecommerce", [
        "crm_search_contacts",
        "crm_search_products",
        "crm_list_contact_orders",
      ]);
      const tools = pickToolsFromMcp(input);

      expect(tools.crm_search_contacts).toBeDefined();
      expect(tools.crm_search_products).toBeDefined();
      expect(tools.crm_list_contact_orders).toBeDefined();
    });

    it("organização 'vehicles' NÃO recebe ferramentas de e-commerce, mas recebe ferramentas universais", () => {
      const input = makeInput("vehicles", [
        "crm_search_contacts",
        "crm_search_products",
        "crm_list_contact_orders",
      ]);
      const tools = pickToolsFromMcp(input);

      expect(tools.crm_search_contacts).toBeDefined();
      expect(tools.crm_search_products).toBeUndefined();
      expect(tools.crm_list_contact_orders).toBeUndefined();
    });

    it("FAIL-CLOSED: organização com nicho nulo/não resolvido NÃO recebe ferramentas de e-commerce", () => {
      const input = makeInput(null, [
        "crm_search_contacts",
        "crm_search_products",
        "crm_list_contact_orders",
      ]);
      const tools = pickToolsFromMcp(input);

      expect(tools.crm_search_contacts).toBeDefined();
      expect(tools.crm_search_products).toBeUndefined();
      expect(tools.crm_list_contact_orders).toBeUndefined();
    });

    it("FAIL-CLOSED: organização com nicho indefinido NÃO recebe ferramentas de e-commerce", () => {
      const input = makeInput(undefined, [
        "crm_search_contacts",
        "crm_search_products",
        "crm_list_contact_orders",
      ]);
      const tools = pickToolsFromMcp(input);

      expect(tools.crm_search_contacts).toBeDefined();
      expect(tools.crm_search_products).toBeUndefined();
      expect(tools.crm_list_contact_orders).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Bloqueio no nível de Handler (Defense-in-depth)
  // -------------------------------------------------------------------------
  describe("4. Validação direta nos handlers de e-commerce", () => {
    it("crmListContactOrders rejeita execução se ctx.nicheId for 'vehicles'", async () => {
      const ctx: McpContext = {
        organizationId: ORG_VEHICLES,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        requestId: "req-1",
        nicheId: "vehicles",
        supabase: {} as never,
      };

      await expect(
        crmListContactOrders.handler(
          { contact_id: "00000000-0000-0000-0000-000000000001", limite: 10 },
          ctx,
        ),
      ).rejects.toThrow(/nicho_incompativel.*ecommerce/);
    });

    it("crmSearchProducts rejeita execução se ctx.nicheId for 'vehicles'", async () => {
      const ctx: McpContext = {
        organizationId: ORG_VEHICLES,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        requestId: "req-1",
        nicheId: "vehicles",
        supabase: {} as never,
      };

      await expect(
        crmSearchProducts.handler({ termo: "iphone", limite: 8, somente_disponiveis: true }, ctx),
      ).rejects.toThrow(/nicho_incompativel.*ecommerce/);
    });

    it("FAIL-CLOSED: crmSearchProducts rejeita se nicheId for null e banco confirmar null", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: null },
                error: null,
              }),
            }),
          }),
        }),
      };

      const ctx: McpContext = {
        organizationId: ORG_SEM_NICHO,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        requestId: "req-1",
        nicheId: undefined,
        supabase: mockSupabase as never,
      };

      await expect(
        crmSearchProducts.handler({ termo: "iphone", limite: 8, somente_disponiveis: true }, ctx),
      ).rejects.toThrow(/nicho_incompativel/);
    });

    it("ferramentas exclusivas de veículos (futuras) rejeitam organização 'ecommerce'", async () => {
      // Simula uma ferramenta de veículos com requiresNiche: 'vehicles'
      const vehicleToolMock: McpToolDefinition<{ query: z.ZodString }> = {
        name: "crm_search_vehicles",
        description: "Busca veículos",
        inputSchema: { query: z.string() },
        category: "read",
        requiresRole: "agent",
        requiresScope: "mcp:read",
        requiresNiche: "vehicles",
        handler: async (_input, ctx) => {
          const niche = ctx.nicheId ?? (await resolveOrganizationNiche(ctx.supabase, ctx.organizationId));
          if (niche !== "vehicles") {
            throw new Error(`nicho_incompativel: esta ferramenta requer o nicho 'vehicles' (atual: '${niche ?? "indefinido"}')`);
          }
          return { veiculos: [] };
        },
      };

      const ctxEcommerce: McpContext = {
        organizationId: ORG_ECOMMERCE,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        requestId: "req-1",
        nicheId: "ecommerce",
        supabase: {} as never,
      };

      await expect(
        vehicleToolMock.handler({ query: "civic" }, ctxEcommerce),
      ).rejects.toThrow(/nicho_incompativel.*vehicles/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Bloqueio no servidor MCP (createMcpServer)
  // -------------------------------------------------------------------------
  describe("5. Bloqueio no servidor MCP (createMcpServer)", () => {
    it("createMcpServer rejeita execução com isError e mensagem técnica se nicho for incompatível", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { niche_id: "vehicles" },
                error: null,
              }),
            }),
          }),
        }),
      };
      const { createAdminClient } = await import("@/lib/supabase/admin");
      vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);

      const { createMcpServer } = await import("@/lib/mcp/server");
      const auth: McpAuthResult = {
        organizationId: ORG_VEHICLES,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        scopes: ["mcp:read", "mcp:write"],
      };

      const server = createMcpServer(auth, "req-test-1");
      const registeredTools = (server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: unknown) => Promise<{ isError?: boolean; content?: Array<{ text: string }> }> }
        >;
      })._registeredTools;

      const productsTool = registeredTools["crm_search_products"];
      expect(productsTool).toBeDefined();
      if (!productsTool) throw new Error("productsTool not registered");

      const res = await productsTool.handler({ termo: "iphone" });
      expect(res.isError).toBe(true);
      expect(res.content?.[0]?.text).toMatch(/nicho_incompativel.*ecommerce/);
    });

    it("createMcpServer rejeita execução com isError se nicho não for resolvido (fail-closed)", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db timeout" },
              }),
            }),
          }),
        }),
      };
      const { createAdminClient } = await import("@/lib/supabase/admin");
      vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);

      const { createMcpServer } = await import("@/lib/mcp/server");
      const auth: McpAuthResult = {
        organizationId: ORG_SEM_NICHO,
        role: "agent",
        actor: mockActor,
        apiTokenId: "token-1",
        scopes: ["mcp:read", "mcp:write"],
      };

      const server = createMcpServer(auth, "req-test-2");
      const registeredTools = (server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: unknown) => Promise<{ isError?: boolean; content?: Array<{ text: string }> }> }
        >;
      })._registeredTools;

      const productsTool = registeredTools["crm_search_products"];
      expect(productsTool).toBeDefined();
      if (!productsTool) throw new Error("productsTool not registered");

      const res = await productsTool.handler({ termo: "iphone" });
      expect(res.isError).toBe(true);
      expect(res.content?.[0]?.text).toMatch(/nicho_incompativel/);
    });
  });
});
