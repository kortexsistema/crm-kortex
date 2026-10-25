/**
 * Extrator de texto para planilhas (.csv e .xlsx) no pipeline do RAG.
 *
 * Converte dados tabulares em texto estruturado por registro/linha:
 * "Item 1:\n[Coluna 1]: [Valor] | [Coluna 2]: [Valor]"
 * com quebras de linha duplas (\n\n) entre os registros para que o chunker semântico
 * do RAG preserve a integridade e o contexto de cada item.
 */

import { decodificarCsv, parseCsv } from "@/lib/contacts/csv";
import { parseExcel } from "@/lib/sheets/excel";
import { converterLinhasEmTextoUniversal } from "@/lib/integrations/google-sheets/universal-converter";

export class SpreadsheetExtractError extends Error {
  readonly code = "spreadsheet_extract_error";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SpreadsheetExtractError";
  }
}

export async function extractSpreadsheetText(
  buffer: Buffer,
  extensao: "csv" | "xlsx",
): Promise<string> {
  let rows: string[][];

  if (extensao === "xlsx") {
    try {
      rows = await parseExcel(buffer);
    } catch (err) {
      throw new SpreadsheetExtractError(
        `Falha ao processar arquivo .xlsx: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  } else {
    const decodificado = decodificarCsv(buffer);
    if ("erro" in decodificado) {
      throw new SpreadsheetExtractError(decodificado.erro);
    }
    rows = parseCsv(decodificado.texto).filter((r) => r.some((c) => c.trim() !== ""));
  }

  if (rows.length === 0) {
    throw new SpreadsheetExtractError("A planilha está vazia.");
  }

  const cabecalho = rows[0]!;
  if (rows.length === 1) {
    throw new SpreadsheetExtractError(
      "A planilha contém apenas o cabeçalho, sem linhas de dados para indexar.",
    );
  }

  const resultado = converterLinhasEmTextoUniversal(rows, {
    titulo: "DOCUMENTO DE CONHECIMENTO",
  });

  if (!resultado.markdown || resultado.markdown.trim().length === 0) {
    throw new SpreadsheetExtractError("A planilha não possui dados legíveis para indexação.");
  }

  return resultado.markdown;
}
