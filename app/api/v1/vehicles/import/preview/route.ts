/**
 * POST /api/v1/vehicles/import/preview
 *
 * Pré-visualização e validação segura de planilhas de estoque de veículos (XLSX/CSV).
 *
 * ⚠️ REGRAS DE SEGURANÇA E GOVERNANÇA:
 * - Apenas gestores (role >= 'manager') e administradores da organização.
 * - Organização DEVE estar configurada no nicho 'vehicles'. Fail-closed absoluto.
 * - Leitura sem efeitos colaterais no estoque: NÃO insere, atualiza nem exclui veículos.
 * - Cria um lote de importação com status 'preview' para rastreabilidade e auditoria.
 * - Campos confidenciais (chassi, placa completa, custos) são mascarados/omitidos
 *   na resposta para evitar vazamento inadvertido.
 */
import { createHash, randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { createClient } from "@/lib/supabase/server";
import { parseVehicleSpreadsheet } from "@/lib/vehicles/planilha";
import { sanitizarVeiculoParaVisualizacao, mascararChassi, mascararPlaca } from "@/lib/vehicles/sanitizer";
import type { VehicleDuplicate, VehiclePreviewApiResponse } from "@/lib/vehicles/types";

export const dynamic = "force-dynamic";

/** Tamanho máximo do arquivo: 10 MB */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Limite máximo de linhas na planilha */
const MAX_DATA_ROWS = 5000;

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

  // 2. Extração e validação do arquivo multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie a planilha via formulário multipart/form-data.", 422, {
      requestId,
    });
  }

  const arquivo = form.get("file");
  const pareceArquivo =
    typeof arquivo === "object" &&
    arquivo !== null &&
    typeof (arquivo as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (arquivo as { size?: unknown }).size === "number";

  if (!pareceArquivo) {
    return fail("validation_failed", "Envie o arquivo no campo 'file'.", 422, { requestId });
  }

  const file = arquivo as unknown as File;
  const filename = file.name || "planilha_veiculos.xlsx";
  const filenameLower = filename.toLowerCase();

  const isCsv =
    filenameLower.endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";
  const isXlsx =
    filenameLower.endsWith(".xlsx") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (!isCsv && !isXlsx) {
    return fail(
      "validation_failed",
      "Formato não suportado. Por favor, envie uma planilha no formato .xlsx ou .csv.",
      422,
      { requestId },
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(
      "validation_failed",
      `Arquivo maior que o limite permitido de ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.`,
      413,
      { requestId },
    );
  }

  // 3. Leitura e cálculo de hash de integridade
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // 4. Parser e validação estrutural dos dados
  const report = await parseVehicleSpreadsheet(buffer);

  if (report.totalLinhas > MAX_DATA_ROWS) {
    return fail(
      "validation_failed",
      `A planilha contém ${report.totalLinhas} linhas, ultrapassando o limite máximo de ${MAX_DATA_ROWS} linhas por lote.`,
      422,
      { requestId },
    );
  }

  // 5. Verificação de duplicidades contra o banco de dados (estoque existente da organização)
  const chassisParaChecar = report.veiculosValidos
    .map((v) => v.chassi)
    .filter((c): c is string => Boolean(c));
  const placasParaChecar = report.veiculosValidos
    .map((v) => v.placa_completa)
    .filter((p): p is string => Boolean(p));

  const duplicatasEstoque: VehicleDuplicate[] = [];
  const setChassisExistentes = new Set<string>();
  const setPlacasExistentes = new Set<string>();

  if (chassisParaChecar.length > 0 || placasParaChecar.length > 0) {
    let query = supabase
      .from("vehicles")
      .select("id, chassi, placa_completa")
      .eq("organization_id", orgId);

    if (chassisParaChecar.length > 0 && placasParaChecar.length > 0) {
      query = query.or(
        `chassi.in.(${chassisParaChecar.map((c) => `"${c}"`).join(",")}),placa_completa.in.(${placasParaChecar.map((p) => `"${p}"`).join(",")})`,
      );
    } else if (chassisParaChecar.length > 0) {
      query = query.in("chassi", chassisParaChecar);
    } else {
      query = query.in("placa_completa", placasParaChecar);
    }

    const { data: conflitos, error: errConflitos } = await query;
    if (!errConflitos && conflitos) {
      for (const row of conflitos) {
        if (row.chassi) setChassisExistentes.add(row.chassi.toUpperCase());
        if (row.placa_completa) setPlacasExistentes.add(row.placa_completa.toUpperCase());
      }
    }
  }

  // Identifica quais veículos válidos da planilha colidem com o estoque
  const veiculosElegiveis = report.veiculosValidos.filter((v) => {
    if (v.chassi && setChassisExistentes.has(v.chassi.toUpperCase())) {
      duplicatasEstoque.push({
        linha: v.linha,
        linhaConflitante: 0,
        tipo: "chassi",
        identificador: v.chassi,
        mensagem: `Chassi "${mascararChassi(v.chassi)}" já cadastrado no estoque da empresa.`,
      });
      return false;
    }
    if (v.placa_completa && setPlacasExistentes.has(v.placa_completa.toUpperCase())) {
      duplicatasEstoque.push({
        linha: v.linha,
        linhaConflitante: 0,
        tipo: "placa",
        identificador: v.placa_completa,
        mensagem: `Placa "${mascararPlaca(v.placa_completa)}" já cadastrada no estoque da empresa.`,
      });
      return false;
    }
    return true;
  });

  const totalDuplicatas = report.duplicatas.length + duplicatasEstoque.length;

  // 6. Registro do lote em status 'preview' (sem alterar vehicles)
  const errosSerializaveis = [
    ...report.erros,
    ...duplicatasEstoque.map((d) => ({
      linha: d.linha,
      campo: d.tipo,
      motivo: d.mensagem,
    })),
  ];

  const { data: batch, error: batchErr } = await supabase
    .from("vehicle_import_batches")
    .insert({
      organization_id: orgId,
      filename,
      file_size_bytes: file.size,
      file_hash: fileHash,
      total_rows: report.totalLinhas,
      imported_count: 0,
      duplicate_count: totalDuplicatas,
      error_count: report.erros.length,
      status: "preview",
      errors: errosSerializaveis,
      metadata: {
        preview: true,
        validos_count: veiculosElegiveis.length,
        colunas_detectadas: report.colunasDetectadas,
        colunas_ignoradas: report.colunasIgnoradas,
      },
      created_by: authz.user.id,
    })
    .select("id")
    .single();

  if (batchErr || !batch) {
    return fail("database_error", "Falha ao registrar o lote de pré-visualização.", 500, {
      requestId,
    });
  }

  // 7. Auditoria do evento de pré-visualização
  void audit({
    organizationId: orgId,
    action: "vehicles.import_previewed",
    actorUserId: authz.user.id,
    resourceType: "vehicle_import_batch",
    resourceId: batch.id,
    requestId,
    metadata: {
      filename,
      total_rows: report.totalLinhas,
      valid_count: veiculosElegiveis.length,
      duplicate_count: totalDuplicatas,
      error_count: report.erros.length,
    },
  });

  // 8. Resposta segura sem vazamento de dados confidenciais
  const resposta: VehiclePreviewApiResponse = {
    batch_id: batch.id,
    filename,
    file_size_bytes: file.size,
    file_hash: fileHash,
    resumo: {
      total_linhas: report.totalLinhas,
      validos_count: veiculosElegiveis.length,
      duplicatas_planilha_count: report.duplicatas.length,
      duplicatas_estoque_count: duplicatasEstoque.length,
      erros_count: report.erros.length,
    },
    colunas_detectadas: report.colunasDetectadas,
    colunas_ignoradas: report.colunasIgnoradas,
    erros: report.erros,
    duplicatas: [
      ...report.duplicatas.map((d) => ({
        linha: d.linha,
        tipo: d.tipo,
        identificador_mascarado:
          d.tipo === "chassi" ? mascararChassi(d.identificador) : mascararPlaca(d.identificador),
        mensagem: d.mensagem,
      })),
      ...duplicatasEstoque.map((d) => ({
        linha: d.linha,
        tipo: d.tipo,
        identificador_mascarado:
          d.tipo === "chassi" ? mascararChassi(d.identificador) : mascararPlaca(d.identificador),
        mensagem: d.mensagem,
      })),
    ],
    // Retorna amostra sanitizada de até 25 veículos para conferência visual
    amostra_veiculos: veiculosElegiveis.slice(0, 25).map(sanitizarVeiculoParaVisualizacao),
  };

  return ok(resposta, { requestId });
}
