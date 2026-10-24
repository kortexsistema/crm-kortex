import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  BUSINESS_NICHES,
  businessNicheSchema,
  getActiveBusinessNiches,
  isBusinessNiche,
  isEcommerceNiche,
  isVehiclesNiche,
  resolveNicheId,
} from "@/lib/niches/types";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { GET, PATCH } from "@/app/api/v1/admin/tenants/[id]/niche/route";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

describe("Governança e Domínio de Nichos de Negócio", () => {
  it("contém os nichos canônicos 'ecommerce' e 'vehicles'", () => {
    expect(BUSINESS_NICHES).toContain("ecommerce");
    expect(BUSINESS_NICHES).toContain("vehicles");
  });

  it("businessNicheSchema valida nichos permitidos e rejeita desconhecidos", () => {
    expect(businessNicheSchema.parse("ecommerce")).toBe("ecommerce");
    expect(businessNicheSchema.parse("vehicles")).toBe("vehicles");
    expect(() => businessNicheSchema.parse("imobiliaria")).toThrow();
    expect(() => businessNicheSchema.parse("")).toThrow();
  });

  it("isBusinessNiche reconhece valores válidos", () => {
    expect(isBusinessNiche("ecommerce")).toBe(true);
    expect(isBusinessNiche("vehicles")).toBe(true);
    expect(isBusinessNiche("qualquer")).toBe(false);
    expect(isBusinessNiche(null)).toBe(false);
    expect(isBusinessNiche(123)).toBe(false);
  });

  it("resolveNicheId aplica fallback seguro para 'ecommerce'", () => {
    expect(resolveNicheId("vehicles")).toBe("vehicles");
    expect(resolveNicheId("ecommerce")).toBe("ecommerce");
    expect(resolveNicheId("invalido")).toBe("ecommerce");
    expect(resolveNicheId(null)).toBe("ecommerce");
    expect(resolveNicheId(undefined)).toBe("ecommerce");
  });

  it("helpers booleanos identificam corretamente os nichos", () => {
    expect(isVehiclesNiche("vehicles")).toBe(true);
    expect(isVehiclesNiche("ecommerce")).toBe(false);
    expect(isEcommerceNiche("ecommerce")).toBe(true);
    expect(isEcommerceNiche("vehicles")).toBe(false);
  });

  it("getActiveBusinessNiches retorna apenas nichos ativos e homologados", () => {
    const active = getActiveBusinessNiches();
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.every((n) => n.active)).toBe(true);
    expect(active.map((n) => n.id)).toContain("ecommerce");
    expect(active.map((n) => n.id)).toContain("vehicles");
  });

  it("AUDIT_ACTIONS registra a ação 'tenant.niche_updated'", () => {
    expect(AUDIT_ACTIONS).toContain("tenant.niche_updated");
  });
});

describe("Rota Administrativa de Nicho: /api/v1/admin/tenants/[id]/niche", () => {
  const TENANT_ID = "33333333-3333-4333-8333-333333333333";
  const ADMIN_USER_ID = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET bloqueia requisição se caller não for Platform Admin (403)", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error("forbidden"));

    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`);
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("GET retorna nicho atual e opções disponíveis para Platform Admin", async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValueOnce({
      user: { id: ADMIN_USER_ID } as never,
    } as never);

    const adminStub = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: async () => ({
              data: { id: TENANT_ID, niche_id: "vehicles" },
              error: null,
            }),
          }),
        }),
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(adminStub as never);

    const req = new NextRequest(`http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`);
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.niche_id).toBe("vehicles");
    expect(body.data.organization_id).toBe(TENANT_ID);
    expect(body.data.available_niches.length).toBeGreaterThanOrEqual(2);
  });

  it("PATCH bloqueia requisição se caller não for Platform Admin (403)", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error("forbidden"));

    const req = new NextRequest(
      `http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`,
      {
        method: "PATCH",
        body: JSON.stringify({ niche_id: "vehicles" }),
      },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(403);
  });

  it("PATCH rejeita corpo com nicho desconhecido com 400 validation_failed", async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValueOnce({
      user: { id: ADMIN_USER_ID } as never,
    } as never);

    const req = new NextRequest(
      `http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`,
      {
        method: "PATCH",
        body: JSON.stringify({ niche_id: "nicho_fantasma" }),
      },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("PATCH rejeita com 422 se nicho estiver inativo no banco", async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValueOnce({
      user: { id: ADMIN_USER_ID } as never,
    } as never);

    const adminStub = {
      from: vi.fn((table: string) => {
        if (table === "business_niches") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: async () => ({
                  data: { id: "vehicles", active: false },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: async () => ({ data: { id: TENANT_ID }, error: null }),
            }),
          }),
        };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(adminStub as never);

    const req = new NextRequest(
      `http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`,
      {
        method: "PATCH",
        body: JSON.stringify({ niche_id: "vehicles" }),
      },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("unprocessable_entity");
  });

  it("PATCH atualiza o nicho da organização e emite registro de auditoria", async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValueOnce({
      user: { id: ADMIN_USER_ID } as never,
    } as never);

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const adminStub = {
      from: vi.fn((table: string) => {
        if (table === "business_niches") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: async () => ({
                  data: { id: "vehicles", active: true },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "organizations") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: async () => ({
                  data: { id: TENANT_ID, niche_id: "ecommerce" },
                  error: null,
                }),
              }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Tabela não esperada: ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(adminStub as never);

    const req = new NextRequest(
      `http://localhost/api/v1/admin/tenants/${TENANT_ID}/niche`,
      {
        method: "PATCH",
        body: JSON.stringify({ niche_id: "vehicles" }),
      },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.niche_id).toBe("vehicles");
    expect(body.data.id).toBe(TENANT_ID);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        niche_id: "vehicles",
      }),
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.niche_updated",
        organizationId: TENANT_ID,
        actorUserId: ADMIN_USER_ID,
        actingAsPlatformAdmin: true,
        metadata: expect.objectContaining({
          tenant_id: TENANT_ID,
          old_niche: "ecommerce",
          new_niche: "vehicles",
        }),
      }),
    );
  });
});
