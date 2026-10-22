/**
 * Parser de planilhas Excel (.xlsx) para o backend Node.js via exceljs.
 *
 * Converte um buffer de arquivo .xlsx em uma matriz bidimensional de strings (string[][]),
 * preservando a ordem das colunas e normalizando valores de texto, fórmulas e números.
 */

import ExcelJS from "exceljs";

export class ExcelParseError extends Error {
  readonly code = "excel_parse_error";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExcelParseError";
  }
}

function extrairTextoDaCelula(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    // Fórmulas com resultado calculado
    if ("result" in value && value.result !== undefined && value.result !== null) {
      if (value.result instanceof Date) {
        return value.result.toISOString();
      }
      return String(value.result).trim();
    }

    // Texto com formatação rica (richText)
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();
    }

    // Células com hiperlink
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
  }

  return String(value).trim();
}

/**
 * Lê o buffer de uma planilha .xlsx e retorna todas as linhas como string[][].
 */
export async function parseExcel(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<string[][]> {
  try {
    const workbook = new ExcelJS.Workbook();
    const buf = Buffer.isBuffer(buffer)
      ? buffer
      : buffer instanceof Uint8Array
        ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : Buffer.from(buffer);
    await workbook.xlsx.load(buf as never);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return [];
    }

    const rows: string[][] = [];
    const maxCols = worksheet.columnCount || 0;

    worksheet.eachRow({ includeEmpty: false }, (row: ExcelJS.Row) => {
      const cellCount = Math.max(maxCols, row.cellCount);
      const rowValues: string[] = [];

      for (let col = 1; col <= cellCount; col++) {
        const cell = row.getCell(col);
        rowValues.push(extrairTextoDaCelula(cell.value));
      }

      // Só inclui linhas que tenham pelo menos uma célula não-vazia
      if (rowValues.some((v) => v !== "")) {
        // Remove células vazias do final da linha para não poluir
        while (rowValues.length > 0 && rowValues[rowValues.length - 1] === "") {
          rowValues.pop();
        }
        rows.push(rowValues);
      }
    });

    return rows;
  } catch (err) {
    if (err instanceof ExcelParseError) throw err;
    throw new ExcelParseError(
      `Falha ao processar o arquivo Excel (.xlsx): ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
