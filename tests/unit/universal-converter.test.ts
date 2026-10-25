import { describe, it, expect } from "vitest";
import { converterLinhasEmTextoUniversal } from "@/lib/integrations/google-sheets/universal-converter";

describe("Conversor Universal de Planilhas para Documento de Conhecimento", () => {
  it("converte estoque de veículos com seções/marcas no formato exato de documento", () => {
    const csvContent = [
      "Modelo,Ano,Cor,Placa,Preco,Combustivel,Marca",
      "SHINERAY SE1,2022/2022,Cinza,FPQ-0E35,10900,Elétrico,MOTOS E ELÉTRICOS",
      "BIZ 125,2019/2019,Branca,DMB-2B30,,Flex,MOTOS E ELÉTRICOS",
      "BYD DOLPHIN 0km,2026/2027,Preta,UJD-4F34,149900.00,Elétrico,IMPORTADOS",
      "KWID ZEN 2,2025/2026,Cinza,TET-1J30,69900,Flex,RENAULT",
      "CIVIC LXS,2006/2007,Preta,DSS-7110,48900,Gasolina,HONDA",
    ].join("\n");

    const res = converterLinhasEmTextoUniversal(csvContent, {
      titulo: "BASE DE CONHECIMENTO - ESTOQUE ANDERSON MULTIMARCAS",
    });

    expect(res.totalLinhas).toBe(5);
    expect(res.markdown).toContain("# BASE DE CONHECIMENTO - ESTOQUE ANDERSON MULTIMARCAS");
    expect(res.markdown).toContain("## MOTOS E ELÉTRICOS");
    expect(res.markdown).toContain(
      "SHINERAY SE1: 2022/2022, Cinza, Placa: FPQ-0E35, Preço: R$ 10.900,00, Combustível: Elétrico.",
    );
    expect(res.markdown).toContain(
      "BIZ 125: 2019/2019, Branca, Placa: DMB-2B30, Combustível: Flex.",
    );
    expect(res.markdown).toContain("## IMPORTADOS");
    expect(res.markdown).toContain(
      "BYD DOLPHIN 0km: 2026/2027, Preta, Placa: UJD-4F34, Preço: R$ 149.900,00, Combustível: Elétrico.",
    );
    expect(res.markdown).toContain("## RENAULT");
    expect(res.markdown).toContain(
      "KWID ZEN 2: 2025/2026, Cinza, Placa: TET-1J30, Preço: R$ 69.900,00, Combustível: Flex.",
    );
    expect(res.markdown).toContain("## HONDA");
    expect(res.markdown).toContain(
      "CIVIC LXS: 2006/2007, Preta, Placa: DSS-7110, Preço: R$ 48.900,00, Combustível: Gasolina.",
    );
  });

  it("reconhece linhas separadoras de categoria quando não há coluna de marca explícita", () => {
    const csvContent = [
      "Veículo,Ano/Modelo,Cor,Placa,Valor,Combustível",
      "MOTOS E ELÉTRICOS,,,,,,",
      "SHINERAY SE1,2022,Cinza,FPQ-0E35,10900,Elétrico",
      "IMPORTADOS,,,,,,",
      "BYD DOLPHIN,2026,Branca,UOL-1G70,149900,Elétrico",
    ].join("\n");

    const res = converterLinhasEmTextoUniversal(csvContent);

    expect(res.markdown).toContain("## MOTOS E ELÉTRICOS");
    expect(res.markdown).toContain("SHINERAY SE1: 2022/2022, Cinza, Placa: FPQ-0E35, Preço: R$ 10.900,00, Combustível: Elétrico.");
    expect(res.markdown).toContain("## IMPORTADOS");
    expect(res.markdown).toContain("BYD DOLPHIN: 2026/2026, Branca, Placa: UOL-1G70, Preço: R$ 149.900,00, Combustível: Elétrico.");
  });

  it("processa texto com tabulação (copiado direto do Excel/Sheets)", () => {
    const tsvContent = [
      "Produto\tCategoria\tPreço\tEstoque",
      "Camiseta Básica\tVestuário\t79.90\t15",
      "Calça Jeans\tVestuário\t149.00\t8",
    ].join("\n");

    const res = converterLinhasEmTextoUniversal(tsvContent);

    expect(res.markdown).toContain("## VESTUÁRIO");
    expect(res.markdown).toContain("Camiseta Básica: Preço: R$ 79,90, Estoque: 15.");
    expect(res.markdown).toContain("Calça Jeans: Preço: R$ 149,00, Estoque: 8.");
  });
});
