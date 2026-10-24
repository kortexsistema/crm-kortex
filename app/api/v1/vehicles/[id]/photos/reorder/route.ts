/**
 * PATCH /api/v1/vehicles/[id]/photos/reorder
 *
 * Reordena a galeria de fotos do veículo.
 * A foto na posição 0 (`fotos_urls[0]`) é definida como a FOTO DE CAPA principal,
 * utilizada na vitrine, na listagem de estoque e nas consultas do agente de IA no WhatsApp.
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

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const reorderSchema = z.object({
  fotos_urls: z.array(z.string()).min(1, "Envie a lista ordenada de fotos."),
});

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Parâmetros inválidos.", 422, {
      requestId,
    });
  }

  const { fotos_urls: novaOrdem } = parsed.data;
  const fotosAtuais = (vehicle.fotos_urls as string[]) ?? [];

  // Validação de integridade do conjunto: não permite adicionar ou remover URLs via reorder
  if (novaOrdem.length !== fotosAtuais.length) {
    return fail(
      "validation_failed",
      `A nova ordem deve conter exatamente as ${fotosAtuais.length} fotos já cadastradas no veículo.`,
      422,
      { requestId },
    );
  }

  const setAtual = new Set(fotosAtuais);
  const todasPertencem = novaOrdem.every((url) => setAtual.has(url));
  const semDuplicatasNaOrdem = new Set(novaOrdem).size === novaOrdem.length;

  if (!todasPertencem || !semDuplicatasNaOrdem) {
    return fail(
      "validation_failed",
      "A ordenação contém URLs que não pertencem ao veículo ou URLs duplicadas.",
      422,
      { requestId },
    );
  }

  // 4. Atualização no banco de dados
  const { data: updatedVehicle, error: updErr } = await adminClient
    .from("vehicles")
    .update({
      fotos_urls: novaOrdem,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId)
    .eq("organization_id", orgId)
    .select("id, fotos_urls")
    .single();

  if (updErr || !updatedVehicle) {
    return fail("database_error", "Erro ao atualizar a ordenação das fotos do veículo.", 500, {
      requestId,
    });
  }

  // 5. Auditoria da reordenação
  void audit({
    organizationId: orgId,
    action: "vehicles.photos_reordered",
    actorUserId: authz.user.id,
    resourceType: "vehicle",
    resourceId: vehicleId,
    requestId,
    metadata: {
      nova_capa: novaOrdem[0],
      total_fotos: novaOrdem.length,
    },
  });

  return ok(
    {
      vehicle_id: vehicleId,
      capa: novaOrdem[0],
      fotos_urls: updatedVehicle.fotos_urls,
    },
    { requestId },
  );
}
