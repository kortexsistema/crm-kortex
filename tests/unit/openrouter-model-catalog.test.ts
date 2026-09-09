import { describe, expect, it, vi, beforeEach } from "vitest";
import { syncOpenRouterCatalog } from "@/app/actions/settings/syncOpenRouterCatalog";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({
    user: { id: "user-admin", is_platform_admin: true },
  }),
}));

const mockSincronizarCatalogo = vi.fn();
vi.mock("@/app/api/v1/cron/sync-model-catalog/route", () => ({
  sincronizarCatalogo: (...args: unknown[]) => mockSincronizarCatalogo(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("OpenRouter Model Catalog & Sync Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncOpenRouterCatalog invoca sincronizarCatalogo e retorna sucesso", async () => {
    mockSincronizarCatalogo.mockResolvedValueOnce({
      fonte: "openrouter",
      recebidos: 40,
      gravados: 35,
      depreciados: 0,
      ressuscitados: 5,
    });

    const res = await syncOpenRouterCatalog();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.gravados).toBe(35);
      expect(res.recebidos).toBe(40);
    }
    expect(mockSincronizarCatalogo).toHaveBeenCalledTimes(1);
  });

  it("syncOpenRouterCatalog lida com falhas graciosamente retornando erro amigável", async () => {
    mockSincronizarCatalogo.mockRejectedValueOnce(new Error("Network timeout"));

    const res = await syncOpenRouterCatalog();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Network timeout");
    }
  });
});
