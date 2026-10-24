/**
 * POST /api/v1/vehicles/[id]/photos — Upload de fotos para o veículo.
 * DELETE /api/v1/vehicles/[id]/photos — Remoção de uma foto do veículo.
 *
 * ⚠️ DIRETRIZES DE SEGURANÇA E ARMAZENAMENTO:
 * 1. Role mínima: 'manager' (gestor de vendas/frota).
 * 2. Nicho obrigatório: 'vehicles' (fail-closed).
 * 3. Validação estrita de posse: o veículo deve pertencer à organização autenticada.
 * 4. Sniffing binário de bytes: validação por magic numbers (JPEG, PNG, WebP), nunca file.type.
 * 5. Teto de 5 MB por foto e no máximo 15 fotos por veículo.
 * 6. Caminhos não-enumeráveis no storage: `${orgId}/${vehicleId}/${randomUUID()}.${ext}`.
 * 7. Deleção segura: só apaga objetos no storage cujo prefixo case exatamente com `${orgId}/`.
 * 8. Auditoria estruturada via audit() em todas as mutações.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BUCKET_VEHICLE_PHOTOS,
  MAX_PHOTOS_PER_VEHICLE,
  MAX_PHOTO_SIZE_BYTES,
  derivarUrlPublica,
  extensaoDeFoto,
  extrairCaminhoDoBucket,
  farejarTipoFoto,
  gerarCaminhoFoto,
} from "@/lib/vehicles/photos";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const deletePhotoSchema = z.object({
  photo_url: z.string().min(1, "A URL da foto é obrigatória."),
});

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "vehicles" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const { id: vehicleId } = await ctx.params;
  const idValidation = z.string().uuid().safeParse(vehicleId);
  if (!idValidation.success) {
    return fail("validation_failed", "Identificador de veículo inválido.", 400, {
      requestId,
    });
  }

  const supabase = await createClient();

  // 1. Verificação de nicho da organização (fail-closed)
  const niche = await resolveOrganizationNiche(supabase, orgId);
  if (niche !== "vehicles") {
    return fail(
      "forbidden_niche",
      "Esta operação é restrita a organizações que operam no nicho 'Veículos'.",
      403,
      { requestId },
    );
  }

  // 2. Consulta do veículo garantindo isolamento por tenant
  const adminClient = createAdminClient();
  const { data: vehicle, error: vErr } = await adminClient
    .from("vehicles")
    .select("id, organization_id, fotos_urls")
    .eq("id", vehicleId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return fail("vehicle_not_found", "Veículo não encontrado.", 404, { requestId });
  }

  // 3. Extração dos arquivos via FormData
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie a requisição como multipart/form-data.", 422, {
      requestId,
    });
  }

  const rawEntries = [...form.getAll("files"), ...form.getAll("file")];
  const files: File[] = [];

  for (const entry of rawEntries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      typeof (entry as { size?: unknown }).size === "number"
    ) {
      files.push(entry as unknown as File);
    }
  }

  if (files.length === 0) {
    return fail("validation_failed", "Nenhum arquivo de imagem válido foi enviado.", 422, {
      requestId,
    });
  }

  const fotosAtuais = (vehicle.fotos_urls as string[]) ?? [];
  if (fotosAtuais.length + files.length > MAX_PHOTOS_PER_VEHICLE) {
    return fail(
      "limit_exceeded",
      `Limite de ${MAX_PHOTOS_PER_VEHICLE} fotos por veículo excedido. O veículo já possui ${fotosAtuais.length} foto(s) e você tentou adicionar ${files.length}.`,
      422,
      { requestId },
    );
  }

  // 4. Validação binária e upload de cada imagem para o Supabase Storage
  const novasUrls: string[] = [];
  const caminhosCarregados: string[] = [];

  try {
    for (const file of files) {
      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        throw new Error(`O arquivo ${file.name} excede o limite máximo de 5 MB.`);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const tipoReal = farejarTipoFoto(buffer);

      if (!tipoReal) {
        throw new Error(
          `O arquivo ${file.name} possui formato não suportado. Envie imagens válidas em JPEG, PNG ou WebP.`,
        );
      }

      const ext = extensaoDeFoto(tipoReal);
      const storagePath = gerarCaminhoFoto(orgId, vehicleId, ext);

      const { error: uploadErr } = await adminClient.storage
        .from(BUCKET_VEHICLE_PHOTOS)
        .upload(storagePath, buffer, {
          contentType: tipoReal,
          upsert: false,
        });

      if (uploadErr) {
        throw new Error(`Falha ao salvar a imagem no storage: ${uploadErr.message}`);
      }

      caminhosCarregados.push(storagePath);
      const publicUrl = derivarUrlPublica(storagePath);
      novasUrls.push(publicUrl);
    }
  } catch (err) {
    // Rollback de limpeza de eventuais arquivos já subidos se algum falhar
    if (caminhosCarregados.length > 0) {
      void adminClient.storage.from(BUCKET_VEHICLE_PHOTOS).remove(caminhosCarregados);
    }
    const message = err instanceof Error ? err.message : "Erro no upload das fotos.";
    return fail("upload_failed", message, 422, { requestId });
  }

  // 5. Atualização atômica do array fotos_urls do veículo no banco de dados
  const listaFinalFotos = [...fotosAtuais, ...novasUrls];

  const { data: updatedVehicle, error: updErr } = await adminClient
    .from("vehicles")
    .update({
      fotos_urls: listaFinalFotos,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId)
    .eq("organization_id", orgId)
    .select("id, fotos_urls")
    .single();

  if (updErr || !updatedVehicle) {
    // Em caso de erro no banco, remove os arquivos subidos para não deixar órfãos
    void adminClient.storage.from(BUCKET_VEHICLE_PHOTOS).remove(caminhosCarregados);
    return fail("database_error", "Erro ao salvar as URLs das fotos no cadastro do veículo.", 500, {
      requestId,
    });
  }

  // 6. Auditoria de segurança
  void audit({
    organizationId: orgId,
    action: "vehicles.photos_uploaded",
    actorUserId: authz.user.id,
    resourceType: "vehicle",
    resourceId: vehicleId,
    requestId,
    metadata: {
      adicionadas: novasUrls.length,
      total_fotos: listaFinalFotos.length,
    },
  });

  return ok(
    {
      vehicle_id: vehicleId,
      novas_fotos: novasUrls,
      fotos_urls: updatedVehicle.fotos_urls,
    },
    { requestId },
  );
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "vehicles" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const { id: vehicleId } = await ctx.params;
  const idValidation = z.string().uuid().safeParse(vehicleId);
  if (!idValidation.success) {
    return fail("validation_failed", "Identificador de veículo inválido.", 400, {
      requestId,
    });
  }

  const supabase = await createClient();

  // 1. Verificação de nicho
  const niche = await resolveOrganizationNiche(supabase, orgId);
  if (niche !== "vehicles") {
    return fail(
      "forbidden_niche",
      "Esta operação é restrita a organizações que operam no nicho 'Veículos'.",
      403,
      { requestId },
    );
  }

  // 2. Consulta do veículo
  const adminClient = createAdminClient();
  const { data: vehicle, error: vErr } = await adminClient
    .from("vehicles")
    .select("id, organization_id, fotos_urls")
    .eq("id", vehicleId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return fail("vehicle_not_found", "Veículo não encontrado.", 404, { requestId });
  }

  // 3. Validação do body
  const body = await req.json().catch(() => null);
  const parsed = deletePhotoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Parâmetros inválidos.", 422, {
      requestId,
    });
  }

  const { photo_url } = parsed.data;
  const fotosAtuais = (vehicle.fotos_urls as string[]) ?? [];

  if (!fotosAtuais.includes(photo_url)) {
    return fail("photo_not_found", "A foto indicada não pertence ao cadastro deste veículo.", 404, {
      requestId,
    });
  }

  // 4. Remoção do Storage (se a imagem estiver hospedada em nosso bucket e pertencer à organização)
  const caminhoStorage = extrairCaminhoDoBucket(photo_url, orgId);
  if (caminhoStorage) {
    void adminClient.storage.from(BUCKET_VEHICLE_PHOTOS).remove([caminhoStorage]);
  }

  // 5. Atualização no banco de dados
  const listaFinalFotos = fotosAtuais.filter((url) => url !== photo_url);

  const { data: updatedVehicle, error: updErr } = await adminClient
    .from("vehicles")
    .update({
      fotos_urls: listaFinalFotos,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId)
    .eq("organization_id", orgId)
    .select("id, fotos_urls")
    .single();

  if (updErr || !updatedVehicle) {
    return fail("database_error", "Erro ao remover a foto do cadastro do veículo.", 500, {
      requestId,
    });
  }

  // 6. Auditoria de exclusão
  void audit({
    organizationId: orgId,
    action: "vehicles.photo_deleted",
    actorUserId: authz.user.id,
    resourceType: "vehicle",
    resourceId: vehicleId,
    requestId,
    metadata: {
      photo_url,
      restantes: listaFinalFotos.length,
    },
  });

  return ok(
    {
      vehicle_id: vehicleId,
      removida: photo_url,
      fotos_urls: updatedVehicle.fotos_urls,
    },
    { requestId },
  );
}
