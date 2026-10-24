// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { POST as uploadHandler, DELETE as deleteHandler } from "@/app/api/v1/vehicles/[id]/photos/route";
import { PATCH as reorderHandler } from "@/app/api/v1/vehicles/[id]/photos/reorder/route";
import {
  farejarTipoFoto,
  extensaoDeFoto,
  extrairCaminhoDoBucket,
  gerarCaminhoFoto,
  derivarUrlPublica,
  BUCKET_VEHICLE_PHOTOS,
} from "@/lib/vehicles/photos";
import { calcularDimensoes } from "@/lib/vehicles/image-compressor";
import type { RoleCheck } from "@/lib/auth/require-role";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";

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

// Buffers de teste com magic numbers reais
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // tamanho
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20, // VP8
]);
const INVALID_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF ou texto

describe("Módulo de Fotos de Veículos (Storage, API e Utilitários)", () => {
  let vehiclesDb: Map<string, { id: string; organization_id: string; fotos_urls: string[] }>;
  let storageUploads: Array<{ path: string; buffer: Buffer; contentType: string }>;
  let storageDeletions: string[][];

  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesDb = new Map();
    storageUploads = [];
    storageDeletions = [];

    // Veículo padrão existente
    vehiclesDb.set(VEHICLE_ID, {
      id: VEHICLE_ID,
      organization_id: ORG_ID,
      fotos_urls: [
        derivarUrlPublica(`${ORG_ID}/${VEHICLE_ID}/foto1.jpg`, "https://supabase.local"),
        derivarUrlPublica(`${ORG_ID}/${VEHICLE_ID}/foto2.jpg`, "https://supabase.local"),
      ],
    });

    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: mockUser,
      org: mockOrg,
    } as RoleCheck);

    const mockSupabase = {
      from: (tabela: string) => {
        if (tabela === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { niche_id: "vehicles" },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (tabela === "vehicles") {
          return {
            select: (_cols: string) => {
              const filters: Record<string, string> = {};
              const chain = {
                eq: (col: string, val: string) => {
                  filters[col] = val;
                  return chain;
                },
                maybeSingle: async () => {
                  const id = filters["id"];
                  const v = id ? vehiclesDb.get(id) : null;
                  if (!v || (filters["organization_id"] && v.organization_id !== filters["organization_id"])) {
                    return { data: null, error: null };
                  }
                  return { data: { ...v }, error: null };
                },
              };
              return chain;
            },
            update: (updateData: Record<string, unknown>) => {
              const filters: Record<string, string> = {};
              const chain = {
                eq: (col: string, val: string) => {
                  filters[col] = val;
                  return chain;
                },
                select: () => ({
                  single: async () => {
                    const id = filters["id"];
                    if (!id) return { data: null, error: { message: "not found" } };
                    const v = vehiclesDb.get(id);
                    if (!v) return { data: null, error: { message: "not found" } };
                    const updated = { ...v, ...updateData };
                    vehiclesDb.set(id, updated as typeof v);
                    return { data: updated, error: null };
                  },
                }),
              };
              return chain;
            },
          };
        }

        return {};
      },
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe(BUCKET_VEHICLE_PHOTOS);
          return {
            upload: async (path: string, buffer: Buffer, opts: { contentType: string }) => {
              storageUploads.push({ path, buffer, contentType: opts.contentType });
              return { data: { path }, error: null };
            },
            remove: async (paths: string[]) => {
              storageDeletions.push(paths);
              return { data: paths, error: null };
            },
          };
        },
      },
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
  });

  describe("1. Sniffing de Bytes e Derivação de URLs (lib/vehicles/photos)", () => {
    it("detecta corretamente JPEG a partir dos bytes mágicos", () => {
      expect(farejarTipoFoto(JPEG_HEADER)).toBe("image/jpeg");
      expect(extensaoDeFoto("image/jpeg")).toBe("jpg");
    });

    it("detecta corretamente PNG a partir dos bytes mágicos", () => {
      expect(farejarTipoFoto(PNG_HEADER)).toBe("image/png");
      expect(extensaoDeFoto("image/png")).toBe("png");
    });

    it("detecta corretamente WebP a partir dos bytes mágicos RIFF/WEBP", () => {
      expect(farejarTipoFoto(WEBP_HEADER)).toBe("image/webp");
      expect(extensaoDeFoto("image/webp")).toBe("webp");
    });

    it("rejeita formatos não permitidos ou arquivos executáveis", () => {
      expect(farejarTipoFoto(INVALID_HEADER)).toBeNull();
      expect(farejarTipoFoto(Buffer.from("malicious script here"))).toBeNull();
    });

    it("gera caminho não-enumerável escopado na organização", () => {
      const path = gerarCaminhoFoto(ORG_ID, VEHICLE_ID, "webp");
      expect(path.startsWith(`${ORG_ID}/${VEHICLE_ID}/`)).toBe(true);
      expect(path.endsWith(".webp")).toBe(true);
    });

    it("deriva URL pública determinística do Supabase Storage", () => {
      const url = derivarUrlPublica(`${ORG_ID}/${VEHICLE_ID}/foto.jpg`, "https://meu-supabase.com");
      expect(url).toBe(`https://meu-supabase.com/storage/v1/object/public/${BUCKET_VEHICLE_PHOTOS}/${ORG_ID}/${VEHICLE_ID}/foto.jpg`);
    });

    it("extrai caminho do bucket apenas se pertencer à organização", () => {
      const urlOrg = `https://meu-supabase.com/storage/v1/object/public/${BUCKET_VEHICLE_PHOTOS}/${ORG_ID}/${VEHICLE_ID}/foto.jpg`;
      const caminho = extrairCaminhoDoBucket(urlOrg, ORG_ID);
      expect(caminho).toBe(`${ORG_ID}/${VEHICLE_ID}/foto.jpg`);

      // URL de outra organização deve retornar null
      const urlOutraOrg = `https://meu-supabase.com/storage/v1/object/public/${BUCKET_VEHICLE_PHOTOS}/outra-org/${VEHICLE_ID}/foto.jpg`;
      expect(extrairCaminhoDoBucket(urlOutraOrg, ORG_ID)).toBeNull();

      // URL externa (ex: CDN externo) deve retornar null
      expect(extrairCaminhoDoBucket("https://imgur.com/foto.jpg", ORG_ID)).toBeNull();
    });
  });

  describe("2. Dimensionamento Inteligente (lib/vehicles/image-compressor)", () => {
    it("mantém dimensões inalteradas quando a imagem é menor que os tetos", () => {
      const dim = calcularDimensoes(800, 600, 1920, 1080);
      expect(dim).toEqual({ largura: 800, altura: 600 });
    });

    it("redimensiona proporcionalmente quando a largura excede 1920", () => {
      const dim = calcularDimensoes(3840, 2160, 1920, 1080);
      expect(dim.largura).toBe(1920);
      expect(dim.altura).toBe(1080);
    });

    it("redimensiona proporcionalmente quando a altura excede o teto", () => {
      const dim = calcularDimensoes(1000, 2000, 1920, 1080);
      expect(dim.altura).toBe(1080);
      expect(dim.largura).toBe(540);
    });
  });

  describe("3. POST /api/v1/vehicles/[id]/photos (Upload)", () => {
    it("recusa requisição se o nicho da organização não for 'vehicles'", async () => {
      vi.mocked(createClient).mockResolvedValueOnce({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { niche_id: "clinic" }, error: null }),
            }),
          }),
        }),
      } as never);

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "POST",
      });

      const res = await uploadHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("forbidden_niche");
    });

    it("recusa upload se o veículo não pertencer à organização", async () => {
      const req = new NextRequest("http://localhost/api/v1/vehicles/99999999-9999-4999-8999-999999999999/photos", {
        method: "POST",
      });

      const res = await uploadHandler(req, {
        params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("vehicle_not_found");
    });

    it("recusa requisição sem multipart/form-data válido", async () => {
      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "POST",
        body: JSON.stringify({ file: "invalid" }),
      });

      const res = await uploadHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("validation_failed");
    });

    it("recusa arquivo com formato inválido (sniffing falhou)", async () => {
      const formData = new FormData();
      const fakeFile = new File([INVALID_HEADER], "teste.jpg", { type: "image/jpeg" });
      formData.append("files", fakeFile);

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "POST",
        body: formData,
      });

      const res = await uploadHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("upload_failed");
      expect(json.error.message).toContain("formato não suportado");
    });

    it("realiza upload com sucesso de múltiplas fotos válidas", async () => {
      const formData = new FormData();
      const file1 = new File([JPEG_HEADER], "frente.jpg", { type: "image/jpeg" });
      const file2 = new File([WEBP_HEADER], "traseira.webp", { type: "image/webp" });
      formData.append("files", file1);
      formData.append("files", file2);

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "POST",
        body: formData,
      });

      const res = await uploadHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.vehicle_id).toBe(VEHICLE_ID);
      expect(json.data.novas_fotos).toHaveLength(2);
      expect(json.data.fotos_urls).toHaveLength(4); // 2 originais + 2 novas

      // Storage foi chamado para os dois uploads
      expect(storageUploads).toHaveLength(2);
      expect(storageUploads[0]?.contentType).toBe("image/jpeg");
      expect(storageUploads[1]?.contentType).toBe("image/webp");

      // Auditoria foi registrada
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          action: "vehicles.photos_uploaded",
          resourceId: VEHICLE_ID,
        }),
      );
    });

    it("bloqueia upload se exceder o limite de 15 fotos por veículo", async () => {
      // Cria veículo já com 14 fotos
      const fotos14 = Array.from({ length: 14 }, (_, i) => `https://supabase.local/foto${i}.jpg`);
      vehiclesDb.set(VEHICLE_ID, {
        id: VEHICLE_ID,
        organization_id: ORG_ID,
        fotos_urls: fotos14,
      });

      const formData = new FormData();
      const f1 = new File([JPEG_HEADER], "f1.jpg", { type: "image/jpeg" });
      const f2 = new File([JPEG_HEADER], "f2.jpg", { type: "image/jpeg" });
      formData.append("files", f1);
      formData.append("files", f2); // 14 + 2 = 16 (excede 15)

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "POST",
        body: formData,
      });

      const res = await uploadHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("limit_exceeded");
      expect(json.error.message).toContain("Limite de 15 fotos por veículo excedido");
    });
  });

  describe("4. DELETE /api/v1/vehicles/[id]/photos (Exclusão)", () => {
    it("recusa exclusão se a foto não pertencer ao veículo", async () => {
      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "DELETE",
        body: JSON.stringify({ photo_url: "https://outro.com/nao-existe.jpg" }),
      });

      const res = await deleteHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("photo_not_found");
    });

    it("remove foto do banco e do storage com auditoria", async () => {
      const v = vehiclesDb.get(VEHICLE_ID)!;
      const fotoParaRemover = v.fotos_urls[0]!;

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos", {
        method: "DELETE",
        body: JSON.stringify({ photo_url: fotoParaRemover }),
      });

      const res = await deleteHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.removida).toBe(fotoParaRemover);
      expect(json.data.fotos_urls).toHaveLength(1);
      expect(json.data.fotos_urls).not.toContain(fotoParaRemover);

      // Verificou que removeu do storage
      expect(storageDeletions).toHaveLength(1);

      // Auditoria registrada
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          action: "vehicles.photo_deleted",
          resourceId: VEHICLE_ID,
        }),
      );
    });
  });

  describe("5. PATCH /api/v1/vehicles/[id]/photos/reorder (Reordenação & Capa)", () => {
    it("rejeita reordenação se o array contiver URLs adulteradas ou tamanho incorreto", async () => {
      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos/reorder", {
        method: "PATCH",
        body: JSON.stringify({ fotos_urls: ["https://invasor.com/malicioso.jpg"] }),
      });

      const res = await reorderHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("validation_failed");
    });

    it("reordena com sucesso definindo nova foto de capa na posição 0", async () => {
      const v = vehiclesDb.get(VEHICLE_ID)!;
      const [foto1, foto2] = v.fotos_urls;
      const ordemInvertida = [foto2!, foto1!];

      const req = new NextRequest("http://localhost/api/v1/vehicles/" + VEHICLE_ID + "/photos/reorder", {
        method: "PATCH",
        body: JSON.stringify({ fotos_urls: ordemInvertida }),
      });

      const res = await reorderHandler(req, { params: Promise.resolve({ id: VEHICLE_ID }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.capa).toBe(foto2);
      expect(json.data.fotos_urls).toEqual(ordemInvertida);

      // Auditoria registrada
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          action: "vehicles.photos_reordered",
          resourceId: VEHICLE_ID,
          metadata: expect.objectContaining({
            nova_capa: foto2,
          }),
        }),
      );
    });
  });
});
