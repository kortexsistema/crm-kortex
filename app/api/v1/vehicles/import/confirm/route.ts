/**
 * POST /api/v1/vehicles/import/confirm
 *
 * Confirmação transacional e idempotente de lote de importação de veículos.
 *
 * ⚠️ GARANTIAS DE ATOMICIDADE ACID, SEGURANÇA E CONCORRÊNCIA (Subetapa 2.6):
 * 1. Role mínima: 'manager' (gestor de vendas/frota) verificada via requireRole.
 * 2. Nicho obrigatório: 'vehicles' (fail-closed na rota E na função PostgreSQL).
 * 3. Chave de idempotência persistida vinculada a (organization_id, batch_id).
 *    Chamadas subsequentes com a mesma chave devolvem o resultado prévio idêntico
 *    sem duplicar inserções (idempotency_replayed: true).
 * 4. Validação de integridade anti-adulteração: compara o hash SHA-256 do arquivo original
 *    com o hash registrado no preview. Rejeita com 422 se divergente.
 * 5. Re-validação e sanitização no servidor antes do envio à RPC.
 * 6. Atomicidade PostgreSQL real: executada dentro de uma única transação atômica
 *    via RPC `fn_confirm_vehicle_import` com trava de linha (SELECT ... FOR UPDATE).
 * 7. Rollback total em qualquer falha: qualquer erro durante a operação reverte 100%
 *    das gravações, garantindo que nenhum veículo parcial seja persistido.
 * 8. Nunca atualiza veículos existentes silenciosamente (preservação estrita do estoque).
 */
import { createHash, randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseVehicleSpreadsheet } from "@/lib/vehicles/planilha";
import type { VehicleConfirmApiResponse } from "@/lib/vehicles/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "vehicles" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const supabase = await createClient();

  // 1. Verificação estrita de nicho (fail-closed)
  const niche = await resolveOrganizationNiche(supabase, orgId);
  if (niche !== "vehicles") {
    return fail(
      "forbidden_niche",
      "Esta operação é restrita a organizações que operam no nicho 'Veículos'.",
      403,
      { requestId },
    );
  }

  // 2. Extração de FormData (file, batch_id, idempotency_key)
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie a requisição como multipart/form-data.", 422, {
      requestId,
    });
  }

  const batchId = String(form.get("batch_id") ?? "").trim();
  const idempotencyKey = String(form.get("idempotency_key") ?? "").trim();
  const arquivo = form.get("file");

  if (!batchId || !idempotencyKey) {
    return fail(
      "validation_failed",
      "Campos obrigatórios ausentes: 'batch_id' e 'idempotency_key' devem ser informados.",
      422,
      { requestId },
    );
  }

  if (idempotencyKey.length < 8) {
    return fail(
      "validation_failed",
      "A chave de idempotência ('idempotency_key') deve possuir no mínimo 8 caracteres.",
      422,
      { requestId },
    );
  }

  const pareceArquivo =
    typeof arquivo === "object" &&
    arquivo !== null &&
    typeof (arquivo as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (arquivo as { size?: unknown }).size === "number";

  if (!pareceArquivo) {
    return fail(
      "validation_failed",
      "Envie o arquivo original no campo 'file' para validação de integridade.",
      422,
      { requestId },
    );
  }

  const file = arquivo as unknown as File;

  // 3. Leitura do buffer e cálculo de hash de integridade
  const buffer = Buffer.from(await file.arrayBuffer());
  const currentFileHash = createHash("sha256").update(buffer).digest("hex");

  // 4. Re-processamento determinístico da planilha (sanitização e validação de regras)
  const report = await parseVehicleSpreadsheet(buffer);

  // 5. Invocação da função PostgreSQL transacional atômica via RPC
  const adminClient = createAdminClient();
  const { data: rpcData, error: rpcErr } = await adminClient.rpc("fn_confirm_vehicle_import", {
    p_org_id: orgId,
    p_batch_id: batchId,
    p_actor_id: authz.user.id,
    p_idempotency_key: idempotencyKey,
    p_file_hash: currentFileHash,
    p_vehicles: report.veiculosValidos,
    p_errors: report.erros,
  });

  if (rpcErr) {
    const msg = rpcErr.message || "";
    if (msg.includes("batch_not_found")) {
      return fail("batch_not_found", "Lote de importação não encontrado para esta organização.", 404, {
        requestId,
      });
    }
    if (msg.includes("forbidden_niche")) {
      return fail(
        "forbidden_niche",
        "Esta operação é restrita a organizações que operam no nicho 'Veículos'.",
        403,
        { requestId },
      );
    }
    if (msg.includes("unauthorized_role")) {
      return fail(
        "unauthorized",
        "Apenas gestores e administradores podem confirmar a importação de veículos.",
        403,
        { requestId },
      );
    }
    if (msg.includes("batch_already_confirmed")) {
      return fail(
        "batch_already_confirmed",
        "Este lote de importação já foi confirmado anteriormente.",
        409,
        { requestId },
      );
    }
    if (msg.includes("invalid_batch_status")) {
      return fail(
        "invalid_batch_status",
        "O lote está em estado incompatível e não pode ser confirmado.",
        409,
        { requestId },
      );
    }
    if (msg.includes("file_hash_mismatch")) {
      return fail(
        "file_hash_mismatch",
        "O arquivo enviado difere do arquivo utilizado na pré-visualização. Por favor, gere uma nova pré-visualização.",
        422,
        { requestId },
      );
    }
    if (msg.includes("idempotency_key_already_used")) {
      return fail(
        "idempotency_key_already_used",
        "A chave de idempotência informada já foi utilizada em outro lote desta organização.",
        409,
        { requestId },
      );
    }

    return fail(
      "persistence_failed",
      "Falha durante a gravação atômica dos veículos no banco de dados. A transação foi revertida sem registros parciais.",
      500,
      { requestId, details: msg },
    );
  }

  const resposta = rpcData as unknown as VehicleConfirmApiResponse;

  // 6. Auditoria do evento de confirmação
  void audit({
    organizationId: orgId,
    action: "vehicles.import_confirmed",
    actorUserId: authz.user.id,
    resourceType: "vehicle_import_batch",
    resourceId: batchId,
    requestId,
    metadata: {
      total_rows: resposta.total_rows,
      imported_count: resposta.imported_count,
      duplicate_count: resposta.duplicate_count,
      error_count: resposta.error_count,
      idempotency_key: idempotencyKey,
      idempotency_replayed: resposta.idempotency_replayed,
    },
  });

  return ok(resposta, { requestId });
}
