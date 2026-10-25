/**
 * Utilitários para normalização e validação de URLs do Google Sheets.
 *
 * Permite que o operador cole o link comum do navegador (ex: /edit#gid=0)
 * ou o link de publicação web (pub?output=csv) e converte automaticamente
 * para o endpoint oficial de exportação CSV do Google Docs.
 */

export interface NormalizedSheetUrl {
  exportCsvUrl: string;
  spreadsheetId: string;
  gid?: string;
}

export function normalizeGoogleSheetsUrl(
  rawUrl: string,
  explicitGid?: string,
): { ok: true; data: NormalizedSheetUrl } | { ok: false; error: string } {
  const urlTrimmed = (rawUrl || "").trim();
  if (!urlTrimmed) {
    return { ok: false, error: "A URL da planilha Google não foi informada." };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlTrimmed);
  } catch {
    return { ok: false, error: "URL inválida. Verifique o link copiado do Google Sheets." };
  }

  if (!parsed.hostname.includes("docs.google.com") || !parsed.pathname.includes("/spreadsheets/")) {
    return {
      ok: false,
      error: "O link informado não pertence ao Google Sheets (docs.google.com/spreadsheets).",
    };
  }

  // Extrair GID se presente na hash ou search params
  let gid: string | undefined = explicitGid?.trim() || undefined;
  if (!gid) {
    if (parsed.searchParams.has("gid")) {
      gid = parsed.searchParams.get("gid") || undefined;
    } else if (parsed.hash) {
      const match = parsed.hash.match(/gid=([0-9]+)/);
      if (match?.[1]) {
        gid = match[1];
      }
    }
  }

  // 1. Caso Planilha Publicada na Web (/pub)
  // Formato: /spreadsheets/d/e/2PACX-1v.../pub?output=csv
  if (parsed.pathname.includes("/spreadsheets/d/e/")) {
    const parts = parsed.pathname.split("/spreadsheets/d/e/");
    const pubId = parts[1]?.split("/")[0] || "";
    if (!pubId) {
      return { ok: false, error: "Não foi possível extrair o identificador da planilha publicada." };
    }

    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/e/${pubId}/pub`);
    exportUrl.searchParams.set("output", "csv");
    if (gid) exportUrl.searchParams.set("gid", gid);

    return {
      ok: true,
      data: {
        exportCsvUrl: exportUrl.toString(),
        spreadsheetId: pubId,
        gid,
      },
    };
  }

  // 2. Caso Planilha Padrão com ID (/spreadsheets/d/<ID>/...)
  const matchId = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!matchId?.[1]) {
    return {
      ok: false,
      error: "Identificador da planilha Google não encontrado na URL fornecida.",
    };
  }

  const spreadsheetId = matchId[1];
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  exportUrl.searchParams.set("format", "csv");
  if (gid) {
    exportUrl.searchParams.set("gid", gid);
  }

  return {
    ok: true,
    data: {
      exportCsvUrl: exportUrl.toString(),
      spreadsheetId,
      gid,
    },
  };
}
