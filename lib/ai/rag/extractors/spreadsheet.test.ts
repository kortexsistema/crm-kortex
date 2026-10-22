import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  extractSpreadsheetText,
  SpreadsheetExtractError,
} from "./spreadsheet";

describe("extractSpreadsheetText", () => {
  it("extrai texto estruturado de um arquivo CSV", async () => {
    const csvContent = [
      "Nome,Preço,Disponibilidade",
      "Plano Pro,R$ 99/mês,Imediata",
      "Plano Enterprise,Sob Consulta,Sob Consulta",
    ].join("\n");

    const buffer = Buffer.from(csvContent, "utf8");
    const text = await extractSpreadsheetText(buffer, "csv");

    expect(text).toContain("Item 1:");
    expect(text).toContain("Nome: Plano Pro | Preço: R$ 99/mês | Disponibilidade: Imediata");
    expect(text).toContain("Item 2:");
    expect(text).toContain("Nome: Plano Enterprise | Preço: Sob Consulta | Disponibilidade: Sob Consulta");
  });

  it("extrai texto estruturado de um arquivo XLSX", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Serviços");

    worksheet.addRow(["Serviço", "Prazo", "Responsável"]);
    worksheet.addRow(["Auditoria LGPD", "15 dias", "Equipe Jurídica"]);
    worksheet.addRow(["Consultoria RAG", "7 dias", "Engenharia de IA"]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const text = await extractSpreadsheetText(buffer, "xlsx");

    expect(text).toContain("Item 1:");
    expect(text).toContain("Serviço: Auditoria LGPD | Prazo: 15 dias | Responsável: Equipe Jurídica");
    expect(text).toContain("Item 2:");
    expect(text).toContain("Serviço: Consultoria RAG | Prazo: 7 dias | Responsável: Engenharia de IA");
  });

  it("rejeita planilha vazia lançando SpreadsheetExtractError", async () => {
    const buffer = Buffer.from("", "utf8");

    await expect(extractSpreadsheetText(buffer, "csv")).rejects.toThrow(
      SpreadsheetExtractError,
    );
  });

  it("rejeita planilha que contenha apenas o cabeçalho", async () => {
    const buffer = Buffer.from("Coluna 1,Coluna 2,Coluna 3\n", "utf8");

    await expect(extractSpreadsheetText(buffer, "csv")).rejects.toThrow(
      "A planilha contém apenas o cabeçalho, sem linhas de dados para indexar.",
    );
  });
});
