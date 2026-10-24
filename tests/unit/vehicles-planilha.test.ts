import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { lerPlanilhaVeiculos } from "@/lib/vehicles/planilha";

describe("Subetapa 2.2 — Parser e Normalizador de Planilhas de Veículos", () => {
  it("processa matriz com colunas automotivas e normaliza campos comerciais", async () => {
    const dados = [
      [
        "Marca",
        "Modelo",
        "Versão",
        "Ano/Mod",
        "Cor",
        "Combustível",
        "Câmbio",
        "Km",
        "Preço de Venda",
        "Placa",
      ],
      [
        "Volkswagen",
        "Gol",
        "1.0 MPI TotalFlex",
        "2020/2021",
        "Branco",
        "Flex",
        "Manual",
        "45.000 km",
        "R$ 54.900,00",
        "ABC-1D23",
      ],
      [
        "Toyota",
        "Corolla",
        "2.0 XEi",
        "2022",
        "Prata",
        "Gasolina",
        "Automático CVT",
        "28000",
        "139900",
        "XYZ-9876",
      ],
    ];

    const resultado = await lerPlanilhaVeiculos(dados);

    expect(resultado.erros).toEqual([]);
    expect(resultado.duplicatas).toEqual([]);
    expect(resultado.totalLinhas).toBe(2);
    expect(resultado.veiculosValidos).toHaveLength(2);

    const gol = resultado.veiculosValidos[0]!;
    expect(gol.marca).toBe("Volkswagen");
    expect(gol.modelo).toBe("Gol");
    expect(gol.versao).toBe("1.0 MPI TotalFlex");
    expect(gol.ano_fabricacao).toBe(2020);
    expect(gol.ano_modelo).toBe(2021);
    expect(gol.cor).toBe("Branco");
    expect(gol.combustivel).toBe("flex");
    expect(gol.cambio).toBe("manual");
    expect(gol.quilometragem).toBe(45000);
    expect(gol.preco_cents).toBe(5490000);
    expect(gol.placa_completa).toBe("ABC1D23");
    expect(gol.placa_final).toBe("3");
    expect(gol.status).toBe("disponivel");

    const corolla = resultado.veiculosValidos[1]!;
    expect(corolla.marca).toBe("Toyota");
    expect(corolla.modelo).toBe("Corolla");
    expect(corolla.ano_fabricacao).toBe(2022);
    expect(corolla.ano_modelo).toBe(2022);
    expect(corolla.cambio).toBe("cvt");
    expect(corolla.quilometragem).toBe(28000);
    expect(corolla.preco_cents).toBe(13990000);
    expect(corolla.placa_final).toBe("6");
  });

  it("NÃO converte preço ou quilometragem ausentes em zero (permanecem null)", async () => {
    const dados = [
      ["Marca", "Modelo", "Km", "Preço de Venda"],
      ["Fiat", "Strada", "", ""],
      ["Chevrolet", "Onix", "   ", "   "],
    ];

    const resultado = await lerPlanilhaVeiculos(dados);

    expect(resultado.erros).toEqual([]);
    expect(resultado.veiculosValidos).toHaveLength(2);

    const strada = resultado.veiculosValidos[0]!;
    expect(strada.quilometragem).toBeNull();
    expect(strada.preco_cents).toBeNull();

    const onix = resultado.veiculosValidos[1]!;
    expect(onix.quilometragem).toBeNull();
    expect(onix.preco_cents).toBeNull();
  });

  it("normaliza anos separados (ano fabricação e ano modelo)", async () => {
    const dados = [
      ["Marca", "Modelo", "Ano Fab", "Ano Mod"],
      ["Honda", "Civic", "2019", "2020"],
      ["Hyundai", "HB20", "2023", ""],
    ];

    const resultado = await lerPlanilhaVeiculos(dados);
    expect(resultado.veiculosValidos[0]!.ano_fabricacao).toBe(2019);
    expect(resultado.veiculosValidos[0]!.ano_modelo).toBe(2020);
    expect(resultado.veiculosValidos[1]!.ano_fabricacao).toBe(2023);
    expect(resultado.veiculosValidos[1]!.ano_modelo).toBeNull();
  });

  it("detecta e deduplica linhas com mesmo chassi ou mesma placa", async () => {
    const dados = [
      ["Marca", "Modelo", "Chassi", "Placa"],
      ["Jeep", "Compass", "9BR1234567890ABCD", "ABC1234"],
      ["Jeep", "Renegade", "9BR1234567890ABCD", "XYZ9999"], // Chassi duplicado
      ["Jeep", "Commander", "9BR9999999999WXYZ", "ABC1234"], // Placa duplicada
    ];

    const resultado = await lerPlanilhaVeiculos(dados);

    expect(resultado.veiculosValidos).toHaveLength(1); // Somente a primeira linha passa
    expect(resultado.duplicatas).toHaveLength(2);

    const dupChassi = resultado.duplicatas.find((d) => d.tipo === "chassi")!;
    expect(dupChassi.linha).toBe(3);
    expect(dupChassi.linhaConflitante).toBe(2);
    expect(dupChassi.identificador).toBe("9BR1234567890ABCD");

    const dupPlaca = resultado.duplicatas.find((d) => d.tipo === "placa")!;
    expect(dupPlaca.linha).toBe(4);
    expect(dupPlaca.linhaConflitante).toBe(2);
    expect(dupPlaca.identificador).toBe("ABC1234");
  });

  it("aponta erros em linhas inválidas sem derrubar as linhas válidas", async () => {
    const dados = [
      ["Marca", "Modelo", "Km", "Preço"],
      ["Ford", "Ka", "30000", "R$ 42.000,00"],
      ["Ford", "", "50000", "R$ 50.000,00"], // Sem modelo
      ["Ford", "EcoSport", "nao informado", "R$ 60.000,00"], // Km inválido
      ["Ford", "Ranger", "10000", "preço a consultar"], // Preço não numérico
    ];

    const resultado = await lerPlanilhaVeiculos(dados);

    expect(resultado.veiculosValidos).toHaveLength(1);
    expect(resultado.veiculosValidos[0]!.modelo).toBe("Ka");
    expect(resultado.erros).toHaveLength(3);
    expect(resultado.erros.map((e) => e.linha)).toEqual([3, 4, 5]);
  });

  it("lê e processa arquivo binário XLSX gerado pelo ExcelJS", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Estoque");

    worksheet.addRow(["Marca", "Modelo", "Ano", "Km", "Preço", "Status"]);
    worksheet.addRow(["Renault", "Duster", "2021/2022", 35000, 78900, "Disponível"]);
    worksheet.addRow(["Peugeot", "208", "2023", 12000, 72000, "Reservado"]);

    const buffer = await workbook.xlsx.writeBuffer();
    const resultado = await lerPlanilhaVeiculos(buffer);

    expect(resultado.erros).toEqual([]);
    expect(resultado.veiculosValidos).toHaveLength(2);

    const duster = resultado.veiculosValidos[0]!;
    expect(duster.marca).toBe("Renault");
    expect(duster.modelo).toBe("Duster");
    expect(duster.ano_fabricacao).toBe(2021);
    expect(duster.ano_modelo).toBe(2022);
    expect(duster.preco_cents).toBe(7890000);
    expect(duster.status).toBe("disponivel");

    const p208 = resultado.veiculosValidos[1]!;
    expect(p208.marca).toBe("Peugeot");
    expect(p208.modelo).toBe("208");
    expect(p208.status).toBe("reservado");
  });
});
