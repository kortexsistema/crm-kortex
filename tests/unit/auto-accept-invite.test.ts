import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  processarAceiteDeConvite,
  tentarAutoAceitarConvitePendente,
} from "@/lib/auth/auto-accept-invite";
import { signInviteToken } from "@/lib/auth/invite-token";

let mockRpcResult: { data: unknown; error: unknown } = {
  data: { id: "membership-1", changed: true },
  error: null,
};
let mockUserMetadata: Record<string, unknown> = {};
const mockCookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      set: mockCookieSet,
      get: vi.fn(),
    }),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/cookie-secure", () => ({
  cookieSecure: () => false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: vi.fn().mockImplementation(() => Promise.resolve(mockRpcResult)),
    auth: {
      admin: {
        getUserById: vi.fn().mockImplementation((id: string) =>
          Promise.resolve({
            data: {
              user: {
                id,
                email: "convidado@empresa.com",
                user_metadata: mockUserMetadata,
              },
            },
            error: null,
          }),
        ),
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  }),
}));

describe("Auto-aceite de convites de equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = { data: { id: "membership-1", changed: true }, error: null };
    mockUserMetadata = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recusa token inválido ou corrompido", async () => {
    const res = await processarAceiteDeConvite("token-invalido", {
      id: "u1",
      email: "teste@empresa.com",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_or_expired");
  });

  it("recusa quando o email do usuário logado diverge do email do convite", async () => {
    const token = signInviteToken({
      invite_id: "11111111-1111-4111-a111-111111111111",
      email: "outro@empresa.com",
      organization_id: "22222222-2222-4222-a222-222222222222",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    const res = await processarAceiteDeConvite(token, {
      id: "33333333-3333-4333-a333-333333333333",
      email: "convidado@empresa.com",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("email_mismatch");
  });

  it("vincula com sucesso o membro quando o token e o e-mail conferem", async () => {
    const token = signInviteToken({
      invite_id: "11111111-1111-4111-a111-111111111111",
      email: "convidado@empresa.com",
      organization_id: "22222222-2222-4222-a222-222222222222",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    const res = await processarAceiteDeConvite(token, {
      id: "33333333-3333-4333-a333-333333333333",
      email: "convidado@empresa.com",
    });
    expect(res.ok).toBe(true);
    expect(res.organizationId).toBe("22222222-2222-4222-a222-222222222222");
    expect(mockCookieSet).toHaveBeenCalledWith(
      "active_org",
      "22222222-2222-4222-a222-222222222222",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("tentaAutoAceitarConvitePendente resgata convite do user_metadata", async () => {
    const token = signInviteToken({
      invite_id: "44444444-4444-4444-a444-444444444444",
      email: "convidado@empresa.com",
      organization_id: "55555555-5555-4555-a555-555555555555",
      role: "manager",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    mockUserMetadata = { invite_token: token };

    const res = await tentarAutoAceitarConvitePendente({
      id: "33333333-3333-4333-a333-333333333333",
      email: "convidado@empresa.com",
    });

    expect(res).not.toBeNull();
    expect(res?.ok).toBe(true);
    expect(res?.organizationId).toBe("55555555-5555-4555-a555-555555555555");
  });
});
