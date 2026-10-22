import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseExcel, ExcelParseError } from "./excel";

describe("parseExcel", () => {
  it("extrai corretamente linhas com células de texto, número e data", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Produtos");

    worksheet.addRow(["codigo", "nome", "preco", "estoque"]);
    worksheet.addRow(["PROD-1", "Teclado Mecânico", "299.90", 15]);
    worksheet.addRow(["PROD-2", "Mouse Gamer", 150, 42]);

    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseExcel(buffer);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["codigo", "nome", "preco", "estoque"]);
    expect(rows[1]).toEqual(["PROD-1", "Teclado Mecânico", "299.90", "15"]);
    expect(rows[2]).toEqual(["PROD-2", "Mouse Gamer", "150", "42"]);
  });

  it("lida com richText e fórmulas com resultado calculado", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Calculos");

    worksheet.addRow(["item", "formula", "rich"]);
    worksheet.addRow(["Teste", { formula: "2+2", result: 4 }, {
      richText: [{ text: "Texto " }, { font: { bold: true }, text: "em Negrito" }],
    }]);

    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseExcel(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["Teste", "4", "Texto em Negrito"]);
  });

  it("ignora linhas completamente vazias e espaços em branco no final", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("ComVazios");

    worksheet.addRow(["A", "B"]);
    worksheet.addRow(["", ""]);
    worksheet.addRow(["Valor A", "Valor B"]);

    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseExcel(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["A", "B"]);
    expect(rows[1]).toEqual(["Valor A", "Valor B"]);
  });

  it("retorna array vazio quando a planilha não tem dados", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Vazia");

    const buffer = await workbook.xlsx.writeBuffer();
    const rows = await parseExcel(buffer);

    expect(rows).toEqual([]);
  });

  it("lança ExcelParseError quando o buffer é inválido ou corrompido", async () => {
    const invalidBuffer = Buffer.from("isto não é um arquivo excel");

    await expect(parseExcel(invalidBuffer)).rejects.toThrow(ExcelParseError);
  });
});
