/**
 * Sincronização automática do estoque e catálogo de produtos via Google Sheets.
 *
 * 1. Lê a planilha do Google Sheets configurada na organização.
 * 2. Valida e processa as colunas usando o parser canônico RFC 4180.
 * 3. Atualiza catalog_products no Supabase (upsert atômico por organization_id + codigo).
 * 4. Garante/atualiza a fonte de conhecimento (ai_knowledge_sources) e dispara a
 *    indexação para o RAG do agente.
 * 5. Registra telemetria, erros de linhas e auditoria.
 */

import { audit } from "@/lib/audit";
import { decodificarCsv } from "@/lib/contacts/csv";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { lerPlanilha, type ErroDaLinha } from "@/lib/catalogo/planilha";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_DE_CONHECIMENTO } from "@/lib/ai/rag/ingest/documento";
import { acquireDebounce, releaseDebounce } from "@/lib/redis-debounce";
import { normalizeGoogleSheetsUrl } from "./url";
import { converterLinhasEmTextoUniversal } from "./universal-converter";
import type { GoogleSheetsStoreMetadata, GoogleSheetsSyncResult } from "./types";

const FETCH_TIMEOUT_MS = 15_000;
const LOTE_UPSERT = 50;
const BATCH_THROTTLE_MS = 100;
const LOCK_TTL_SEC = 300; // 5 minutos
const MAX_SERIALIZATION_RETRIES = 3;
const INITIAL_BACKOFF_MS = 200;

export function isSerializationOrConcurrencyError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const e = err as { code?: string; message?: string; details?: string };
    if (e.code === "40001" || e.code === "40P01") return true;
    const msg = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
    if (
      msg.includes("40001") ||
      msg.includes("google_stale") ||
      msg.includes("could not serialize access") ||
      msg.includes("deadlock detected") ||
      msg.includes("serialization_failure") ||
      msg.includes("lock_not_available")
    ) {
      return true;
    }
  }
  return false;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function upsertLoteComRetry(
  admin: ReturnType<typeof createAdminClient>,
  lote: Array<Record<string, unknown>>,
  maxTentativas = MAX_SERIALIZATION_RETRIES,
  baseDelayMs = INITIAL_BACKOFF_MS,
): Promise<{ ok: true } | { ok: false; error: unknown; isSerialization: boolean }> {
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const { error } = await admin
      .from("catalog_products")
      .upsert(lote, { onConflict: "organization_id,codigo" });

    if (!error) {
      return { ok: true };
    }

    const isSerial = isSerializationOrConcurrencyError(error);
    if (!isSerial || tentativa === maxTentativas) {
      return { ok: false, error, isSerialization: isSerial };
    }

    const backoff = baseDelayMs * Math.pow(2, tentativa - 1) + Math.floor(Math.random() * 50);
    await sleep(backoff);
  }

  return { ok: false, error: new Error("Max retries exceeded"), isSerialization: true };
}

interface SyncParams {
  organizationId: string;
  triggeredBy?: string;
}

export async function syncGoogleSheetsStock(
  params: SyncParams,
): Promise<{ ok: true; data: GoogleSheetsSyncResult } | { ok: false; error: string }> {
  const { organizationId, triggeredBy = "system" } = params;
  const admin = createAdminClient();

  // 1. Carrega a configuração da integração
  const { data: integration, error: intErr } = await admin
    .from("tenant_integrations")
    .select("id, store_metadata, status")
    .eq("organization_id", organizationId)
    .eq("provider", "google_sheets")
    .maybeSingle();

  if (intErr || !integration) {
    return {
      ok: false,
      error: "Integração do Google Sheets não encontrada para esta organização.",
    };
  }

  const meta = (integration.store_metadata as GoogleSheetsStoreMetadata) || {};

  // 1.1 Bloqueio de Concorrência: Lease no banco de dados
  if (meta.sync_locked_until) {
    const lockTime = new Date(meta.sync_locked_until).getTime();
    if (lockTime > Date.now()) {
      return {
        ok: false,
        error: "Uma sincronização já está em andamento para esta organização.",
      };
    }
  }

  // 1.2 Bloqueio de Concorrência: Trava distribuída via Redis (com fallback em memória)
  const redisLockKey = `lock:google_sheets_sync:${organizationId}`;
  const acquiredLock = await acquireDebounce(redisLockKey, LOCK_TTL_SEC);
  if (!acquiredLock) {
    return {
      ok: false,
      error: "Uma sincronização já está em andamento para esta organização.",
    };
  }

  // Marca o lease no banco de dados para visibilidade global
  const lockExpiresAt = new Date(Date.now() + LOCK_TTL_SEC * 1000).toISOString();
  await admin
    .from("tenant_integrations")
    .update({
      store_metadata: {
        ...meta,
        sync_locked_until: lockExpiresAt,
      },
    })
    .eq("id", integration.id);

  try {
    const rawUrl = meta.sheet_url || "";
    const rawGid = meta.sheet_gid;

    const urlNorm = normalizeGoogleSheetsUrl(rawUrl, rawGid);
    if (!urlNorm.ok) {
      await registrarErroDeSincronizacao(admin, organizationId, integration.id, meta, urlNorm.error);
      return { ok: false, error: urlNorm.error };
    }

    // 2. Busca o conteúdo CSV da planilha do Google
    let csvText: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(urlNorm.data.exportCsvUrl, {
        signal: controller.signal,
        headers: {
          Accept: "text/csv, text/plain, */*",
          "User-Agent": "Kortex-Stock-Sync/1.0",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const msg =
          res.status === 403 || res.status === 401
            ? "Acesso negado à planilha. Altere o compartilhamento no Google Sheets para 'Qualquer pessoa com o link pode ler'."
            : res.status === 404
              ? "Planilha não encontrada. Verifique se o link está correto."
              : `Google Sheets respondeu com status ${res.status}.`;
        await registrarErroDeSincronizacao(admin, organizationId, integration.id, meta, msg);
        return { ok: false, error: msg };
      }

      const arrayBuf = await res.arrayBuffer();
      const decodificado = decodificarCsv(arrayBuf);
      if ("erro" in decodificado) {
        await registrarErroDeSincronizacao(
          admin,
          organizationId,
          integration.id,
          meta,
          decodificado.erro,
        );
        return { ok: false, error: decodificado.erro };
      }
      csvText = decodificado.texto;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = isTimeout
        ? "Tempo limite esgotado ao tentar ler a planilha Google (15s)."
        : err instanceof Error
          ? err.message
          : "Erro ao comunicar com o Google Sheets.";
      await registrarErroDeSincronizacao(admin, organizationId, integration.id, meta, msg);
      return { ok: false, error: msg };
    }

    // 3. Atualiza ou garante a fonte de conhecimento no RAG (Prioridade 1: Agente de IA)
    const nowIso = new Date().toISOString();
    const infoConhecimento = await garantirEAtualizarFonteDeConhecimento(admin, organizationId, {
      sheetUrl: rawUrl,
      nowIso,
      csvText,
      integrationId: integration.id,
    });

    // 4. Processa produtos no catálogo relacional (Prioridade 2: Best-effort, não bloqueia o RAG)
    const lido = lerPlanilha(csvText);
    const errosDeGravacao: ErroDaLinha[] = [];
    let criadosCount = 0;
    let atualizadosCount = 0;

    if (!("erro" in lido) && lido.produtos.length > 0) {
      const moeda = await moedaDaOrganizacao(admin, organizationId);
      const codigos = lido.produtos.map((p) => p.codigo);

      let existentes = new Set<string>();
      if (codigos.length > 0) {
        const { data: jaCadastrados } = await admin
          .from("catalog_products")
          .select("codigo")
          .eq("organization_id", organizationId)
          .in("codigo", codigos);

        existentes = new Set((jaCadastrados ?? []).map((r) => (r as { codigo: string }).codigo));
      }

      errosDeGravacao.push(...lido.erros);

      const paraGravar = lido.produtos.map((p) => {
        const jaExiste = existentes.has(p.codigo);
        return {
          organization_id: organizationId,
          codigo: p.codigo,
          nome: p.nome,
          preco_cents: p.preco_cents,
          custo_cents: p.custo_cents,
          marca: p.marca ?? null,
          categoria: p.categoria ?? null,
          quantidade: p.quantidade,
          controla_estoque: p.controla_estoque,
          origem: "google_sheets",
          ativo: true,
          ...(jaExiste ? {} : { moeda }),
        };
      });

      for (let i = 0; i < paraGravar.length; i += LOTE_UPSERT) {
        const lote = paraGravar.slice(i, i + LOTE_UPSERT);
        const resultadoLote = await upsertLoteComRetry(admin, lote);

        if (resultadoLote.ok) {
          for (const item of lote) {
            if (existentes.has(item.codigo)) atualizadosCount++;
            else criadosCount++;
          }
        } else if (resultadoLote.isSerialization) {
          const msg =
            resultadoLote.error instanceof Error
              ? resultadoLote.error.message
              : typeof resultadoLote.error === "object" &&
                  resultadoLote.error !== null &&
                  "message" in resultadoLote.error
                ? String((resultadoLote.error as { message: unknown }).message)
                : "Falha de serialização / concorrência no PostgreSQL (40001)";

          errosDeGravacao.push({
            linha: 0,
            motivo: `Lote de produtos (${lote.length} itens) abortado por concorrência/serialização: ${msg}`,
          });
        } else {
          for (const item of lote) {
            const { error: singleErr } = await admin
              .from("catalog_products")
              .upsert([item], { onConflict: "organization_id,codigo" });

            if (singleErr) {
              errosDeGravacao.push({
                linha: 0,
                motivo: `Produto "${item.nome}" (${item.codigo}): ${singleErr.message}`,
              });
            } else {
              if (existentes.has(item.codigo)) atualizadosCount++;
              else criadosCount++;
            }
          }
        }

        if (i + LOTE_UPSERT < paraGravar.length) {
          await sleep(BATCH_THROTTLE_MS);
        }
      }
    }

    const totalLinhas = infoConhecimento.totalLinhas || (("erro" in lido) ? 0 : lido.produtos.length);

    // 5. Salva o status de sucesso na integração
    const metadataAtualizada: GoogleSheetsStoreMetadata = {
      ...meta,
      last_sync_status: "success",
      last_sync_error: null,
      last_sync_products_count: totalLinhas,
      last_sync_created_count: criadosCount,
      last_sync_updated_count: atualizadosCount,
    };

    await admin
      .from("tenant_integrations")
      .update({
        status: "healthy",
        last_sync_at: nowIso,
        store_metadata: metadataAtualizada,
      })
      .eq("id", integration.id);

    // 6. Registra evento de auditoria
    await audit({
      organizationId,
      action: "integrations.google_sheets.synced",
      resourceType: "tenant_integrations",
      resourceId: integration.id,
      metadata: {
        triggered_by: triggeredBy,
        total_produtos: totalLinhas,
        criados: criadosCount,
        atualizados: atualizadosCount,
        erros: errosDeGravacao.length,
      },
    });

    return {
      ok: true,
      data: {
        total: totalLinhas,
        criados: criadosCount,
        atualizados: atualizadosCount,
        erros: errosDeGravacao,
        colunas_ignoradas: "erro" in lido ? [] : lido.colunasIgnoradas,
      },
    };
  } finally {
    // Libera a trava do Redis e o lease do banco de dados
    try {
      const { data: currentInt } = await admin
        .from("tenant_integrations")
        .select("store_metadata")
        .eq("id", integration.id)
        .maybeSingle();

      const currentMeta = (currentInt?.store_metadata as GoogleSheetsStoreMetadata) || meta;
      const { sync_locked_until: _unused, ...limpoMeta } = currentMeta as Record<string, unknown>;

      await admin
        .from("tenant_integrations")
        .update({
          store_metadata: limpoMeta,
        })
        .eq("id", integration.id);
    } catch (e) {
      console.warn("[google-sheets-sync] Falha ao limpar lease no banco:", e);
    }

    await releaseDebounce(redisLockKey);
  }
}

async function registrarErroDeSincronizacao(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  integrationId: string,
  meta: GoogleSheetsStoreMetadata,
  erroMensagem: string,
): Promise<void> {
  const metadataErro: GoogleSheetsStoreMetadata = {
    ...meta,
    last_sync_status: "error",
    last_sync_error: erroMensagem,
  };

  await admin
    .from("tenant_integrations")
    .update({
      status: "error",
      last_sync_at: new Date().toISOString(),
      store_metadata: metadataErro,
    })
    .eq("id", integrationId);
}

/**
 * Localiza ou cria a fonte de conhecimento de Catálogo para a organização
 * e emite o evento para reindexação do RAG.
 */
async function garantirEAtualizarFonteDeConhecimento(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  dados: {
    sheetUrl: string;
    totalProdutos?: number;
    nowIso: string;
    csvText: string;
    integrationId: string;
  },
): Promise<{ totalLinhas: number }> {
  // 1. Gera o documento de texto universal formatado
  const universal = converterLinhasEmTextoUniversal(dados.csvText, {
    titulo: "BASE DE CONHECIMENTO - ESTOQUE",
  });

  // 2. Salva o arquivo .md no storage do RAG (ai-policy)
  const blobPath = `${organizationId}/estoque-sheets-${dados.integrationId}.md`;
  const { error: uploadErr } = await admin.storage
    .from(BUCKET_DE_CONHECIMENTO)
    .upload(blobPath, Buffer.from(universal.markdown, "utf8"), {
      contentType: "text/markdown",
      upsert: true,
    });

  if (uploadErr) {
    console.warn(
      "[google-sheets-sync] não consegui salvar markdown no storage:",
      uploadErr.message,
    );
  }

  // 3. Localiza ou cria a fonte do tipo "documento"
  const { data: existenteDoc } = await admin
    .from("ai_knowledge_sources")
    .select("id, source_metadata, name")
    .eq("organization_id", organizationId)
    .eq("source_type", "documento")
    .contains("source_metadata", { origem: "google_sheets" })
    .maybeSingle();

  let docSourceId: string;

  if (existenteDoc) {
    docSourceId = existenteDoc.id;
    const metaAtual = (existenteDoc.source_metadata as Record<string, unknown>) || {};
    await admin
      .from("ai_knowledge_sources")
      .update({
        updated_at: dados.nowIso,
        source_metadata: {
          ...metaAtual,
          origem: "google_sheets",
          blob_path: blobPath,
          ext: "md",
          sheet_url: dados.sheetUrl,
          total_linhas: universal.totalLinhas,
          last_synced_at: dados.nowIso,
        },
      })
      .eq("id", docSourceId);
  } else {
    const { data: novaFonte } = await admin
      .from("ai_knowledge_sources")
      .insert({
        organization_id: organizationId,
        source_type: "documento",
        name: "Base de Conhecimento - Estoque",
        status: "ready",
        is_active: true,
        ingested_at: dados.nowIso,
        source_metadata: {
          criada_automaticamente: true,
          origem: "google_sheets",
          blob_path: blobPath,
          ext: "md",
          sheet_url: dados.sheetUrl,
          total_linhas: universal.totalLinhas,
          last_synced_at: dados.nowIso,
        },
      })
      .select("id")
      .single();

    docSourceId = novaFonte?.id || "";
  }

  // 4. Emite o evento knowledge_source.updated para que o indexador RAG
  // processe o documento .md, gere chunks e calcule embeddings para o agente
  if (docSourceId) {
    await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: docSourceId,
      p_payload: {
        knowledge_source_id: docSourceId,
        source_type: "documento",
        origem: "google_sheets",
        triggered_by: "google_sheets_sync",
      },
      p_organization_id: organizationId,
    } as never);
  }

  // 5. Atualiza também a fonte de catálogo (se existir) para garantir sincronismo total
  const { data: existenteCatalogo } = await admin
    .from("ai_knowledge_sources")
    .select("id, source_metadata")
    .eq("organization_id", organizationId)
    .eq("source_type", "catalogo")
    .eq("is_active", true)
    .maybeSingle();

  if (existenteCatalogo) {
    const metaAtual = (existenteCatalogo.source_metadata as Record<string, unknown>) || {};
    await admin
      .from("ai_knowledge_sources")
      .update({
        updated_at: dados.nowIso,
        source_metadata: {
          ...metaAtual,
          origem: "google_sheets",
          sheet_url: dados.sheetUrl,
          total_produtos: dados.totalProdutos,
          last_synced_at: dados.nowIso,
        },
      })
      .eq("id", existenteCatalogo.id);

    await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: existenteCatalogo.id,
      p_payload: {
        knowledge_source_id: existenteCatalogo.id,
        source_type: "catalogo",
        origem: "google_sheets",
        triggered_by: "google_sheets_sync",
      },
      p_organization_id: organizationId,
    } as never);
  }

  return { totalLinhas: universal.totalLinhas };
}

