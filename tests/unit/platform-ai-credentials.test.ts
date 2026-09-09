import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invalidarCacheCredenciaisPlataforma,
  listarCredenciaisDaPlataforma,
  obterCredencialDecifradaDaPlataforma,
  plataformaTemIaConfigurada,
} from "@/lib/ai/credenciais/plataforma";
import { chaveDePlataforma, obterChaveDePlataforma } from "@/lib/ai/runtime/agent";

let mockRows: unknown[] = [];
let mockError: unknown = null;
let mockSafeRows: unknown[] = [];
let mockSafeError: unknown = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "platform_ai_credentials_safe") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: mockSafeRows, error: mockSafeError }),
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: mockRows, error: mockError }),
      };
    },
  }),
}));

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: (val: unknown) => Buffer.isBuffer(val) ? val : Buffer.from(String(val)),
  decryptKey: () => "decrypted-test-key-1234",
}));

describe("platform_ai_credentials — Resolução de credenciais centrais da plataforma", () => {
  beforeEach(() => {
    invalidarCacheCredenciaisPlataforma();
    mockRows = [];
    mockError = null;
    mockSafeRows = [];
    mockSafeError = null;
  });

  afterEach(() => {
    invalidarCacheCredenciaisPlataforma();
    vi.restoreAllMocks();
  });

  it("retorna lista vazia quando tabela não contém linhas ou ocorre erro de banco", async () => {
    mockSafeError = { code: "42P01", message: "relation does not exist" };
    const lista = await listarCredenciaisDaPlataforma();
    expect(lista).toEqual([]);
  });

  it("retorna credenciais seguras formatadas para consumo do /admin", async () => {
    mockSafeRows = [
      {
        provider: "anthropic",
        api_key_last4: "4832",
        models_available: ["claude-3-5-sonnet", "claude-3-haiku"],
        validated_at: "2026-09-08T12:00:00Z",
        validation_error: null,
        is_active: true,
        updated_at: "2026-09-08T12:00:00Z",
        updated_by: "user-1",
      },
    ];

    const lista = await listarCredenciaisDaPlataforma();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.provider).toBe("anthropic");
    expect(lista[0]?.api_key_last4).toBe("4832");
  });

  it("identifica corretamente se a plataforma tem ao menos um provedor ativo", async () => {
    expect(await plataformaTemIaConfigurada()).toBe(false);

    mockRows = [
      {
        provider: "openai",
        api_key_encrypted: "enc",
        api_key_iv: "iv",
        api_key_tag: "tag",
        api_key_last4: "9999",
        models_available: ["gpt-4o"],
        validated_at: "2026-09-08T12:00:00Z",
        validation_error: null,
        is_active: true,
        updated_at: "2026-09-08T12:00:00Z",
        updated_by: null,
      },
    ];

    invalidarCacheCredenciaisPlataforma();
    expect(await plataformaTemIaConfigurada()).toBe(true);
  });

  it("decifra e devolve a chave do provedor solicitado", async () => {
    mockRows = [
      {
        provider: "google",
        api_key_encrypted: "enc",
        api_key_iv: "iv",
        api_key_tag: "tag",
        api_key_last4: "1234",
        models_available: ["gemini-1.5-flash"],
        validated_at: "2026-09-08T12:00:00Z",
        validation_error: null,
        is_active: true,
        updated_at: "2026-09-08T12:00:00Z",
        updated_by: null,
      },
    ];

    invalidarCacheCredenciaisPlataforma();
    const cred = await obterCredencialDecifradaDaPlataforma("google");
    expect(cred).not.toBeNull();
    expect(cred?.apiKey).toBe("decrypted-test-key-1234");
    expect(cred?.models).toContain("gemini-1.5-flash");

    // Provedor inexistente ou desativado devolve null
    const inexistente = await obterCredencialDecifradaDaPlataforma("anthropic");
    expect(inexistente).toBeNull();
  });

  it("obterChaveDePlataforma prioriza platform_ai_credentials e faz fallback para env", async () => {
    mockRows = [
      {
        provider: "anthropic",
        api_key_encrypted: "enc",
        api_key_iv: "iv",
        api_key_tag: "tag",
        api_key_last4: "8888",
        models_available: [],
        validated_at: "2026-09-08T12:00:00Z",
        validation_error: null,
        is_active: true,
        updated_at: "2026-09-08T12:00:00Z",
        updated_by: null,
      },
    ];
    invalidarCacheCredenciaisPlataforma();

    // Com credencial na tabela, retorna ela
    const chave = await obterChaveDePlataforma("anthropic");
    expect(chave).toBe("decrypted-test-key-1234");

    // Provedor sem registro na tabela cai no fallback do env
    const originalEnv = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "sk-env-test-key";
      const chaveEnv = await obterChaveDePlataforma("openai");
      expect(chaveEnv).toBe("sk-env-test-key");
    } finally {
      if (originalEnv !== undefined) process.env.OPENAI_API_KEY = originalEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("chaveDePlataforma resolve variáveis de ambiente inclusive para google", () => {
    const origGoogle = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const origGemini = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      expect(chaveDePlataforma("google")).toBeNull();

      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "goog-key-1";
      expect(chaveDePlataforma("google")).toBe("goog-key-1");

      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      process.env.GEMINI_API_KEY = "gemini-key-2";
      expect(chaveDePlataforma("google")).toBe("gemini-key-2");
    } finally {
      if (origGoogle !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = origGoogle;
      else delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});
