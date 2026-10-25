"use server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { decodificarCsv } from "@/lib/contacts/csv";
import { normalizeGoogleSheetsUrl } from "@/lib/integrations/google-sheets/url";
import { converterLinhasEmTextoUniversal } from "@/lib/integrations/google-sheets/universal-converter";
import { createClient } from "@/lib/supabase/server";
import type { GoogleSheetsStoreMetadata } from "@/lib/integrations/google-sheets/types";

const FETCH_TIMEOUT_MS = 15_000;

export async function convertGoogleSheetsPreview(params?: {
  sheetUrl?: string;
  sheetGid?: string;
  customTitle?: string;
}): Promise<
  | { ok: true; data: { markdown: string; totalLinhas: number } }
  | { ok: false; error: { message: string } }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Autenticação necessária." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  let urlToUse = params?.sheetUrl?.trim();
  let gidToUse = params?.sheetGid?.trim();

  // Se não foi passada URL direta, tenta carregar a que já está salva na integração
  if (!urlToUse) {
    const supabase = await createClient();
    const { data: integration } = await supabase
      .from("tenant_integrations")
      .select("store_metadata")
      .eq("organization_id", activeOrg.orgId)
      .eq("provider", "google_sheets")
      .maybeSingle();

    const meta = (integration?.store_metadata as GoogleSheetsStoreMetadata) || {};
    urlToUse = meta.sheet_url;
    gidToUse = gidToUse || meta.sheet_gid;
  }

  if (!urlToUse) {
    return { ok: false, error: { message: "Informe a URL da Planilha Google para converter." } };
  }

  const norm = normalizeGoogleSheetsUrl(urlToUse, gidToUse);
  if (!norm.ok) {
    return { ok: false, error: { message: norm.error } };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(norm.data.exportCsvUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/csv, text/plain, */*",
        "User-Agent": "Kortex-Converter/1.0",
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
      return { ok: false, error: { message: msg } };
    }

    const arrayBuf = await res.arrayBuffer();
    const decodificado = decodificarCsv(arrayBuf);
    if ("erro" in decodificado) {
      return { ok: false, error: { message: decodificado.erro } };
    }

    const titulo = params?.customTitle || `BASE DE CONHECIMENTO - ESTOQUE ${activeOrg.name.toUpperCase()}`;
    const resultado = converterLinhasEmTextoUniversal(decodificado.texto, { titulo });

    return {
      ok: true,
      data: {
        markdown: resultado.markdown,
        totalLinhas: resultado.totalLinhas,
      },
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const msg = isTimeout
      ? "Tempo limite esgotado ao tentar ler a planilha Google (15s)."
      : err instanceof Error
        ? err.message
        : "Erro ao comunicar com o Google Sheets.";
    return { ok: false, error: { message: msg } };
  }
}
