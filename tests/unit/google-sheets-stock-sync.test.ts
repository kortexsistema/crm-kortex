import { describe, it, expect } from "vitest";
import { normalizeGoogleSheetsUrl } from "@/lib/integrations/google-sheets/url";
import { formatCatalogProductForRag } from "@/lib/integrations/google-sheets/format-rag";
import { lerPlanilha } from "@/lib/catalogo/planilha";

describe("Google Sheets Stock Sync — URL Normalization", () => {
  it("converte link padrão do navegador (/edit#gid=0) para URL de exportação CSV", () => {
    const raw =
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0";
    const res = normalizeGoogleSheetsUrl(raw);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.spreadsheetId).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
      expect(res.data.gid).toBe("0");
      expect(res.data.exportCsvUrl).toBe(
        "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0",
      );
    }
  });

  it("converte link com gid em query parameter (?gid=123456)", () => {
    const raw =
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?gid=123456";
    const res = normalizeGoogleSheetsUrl(raw);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.gid).toBe("123456");
      expect(res.data.exportCsvUrl).toContain("gid=123456");
      expect(res.data.exportCsvUrl).toContain("format=csv");
    }
  });

  it("permite informar gid explícito quando ausente na URL", () => {
    const raw =
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
    const res = normalizeGoogleSheetsUrl(raw, "987");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.gid).toBe("987");
      expect(res.data.exportCsvUrl).toBe(
        "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=987",
      );
    }
  });

  it("trata link publicado na web (/spreadsheets/d/e/.../pub)", () => {
    const raw =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vT3u_Xj/pub?output=csv";
    const res = normalizeGoogleSheetsUrl(raw);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.spreadsheetId).toBe("2PACX-1vT3u_Xj");
      expect(res.data.exportCsvUrl).toContain("/pub");
      expect(res.data.exportCsvUrl).toContain("output=csv");
    }
  });

  it("recusa URLs que não sejam do Google Sheets", () => {
    const res = normalizeGoogleSheetsUrl("https://example.com/planilha.csv");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Google Sheets");
    }
  });

  it("recusa URL vazia ou inválida", () => {
    const resVazia = normalizeGoogleSheetsUrl("");
    expect(resVazia.ok).toBe(false);

    const resInvalida = normalizeGoogleSheetsUrl("not a url");
    expect(resInvalida.ok).toBe(false);
  });
});

describe("Google Sheets Stock Sync — RAG Product Formatter", () => {
  it("formata produto completo com estoque controlado, marca e categoria", () => {
    const texto = formatCatalogProductForRag({
      codigo: "IP15-128",
      nome: "iPhone 15 128GB",
      preco_cents: 499900,
      custo_cents: 380000,
      marca: "Apple",
      categoria: "Smartphones",
      quantidade: 5,
      controla_estoque: true,
      moeda: "BRL",
    });

    expect(texto).toContain("Produto: iPhone 15 128GB");
    expect(texto).toContain("Código / SKU: IP15-128");
    expect(texto).toContain("Preço: BRL 4.999,00");
    expect(texto).toContain("Disponibilidade / Estoque: 5 unidade(s) em estoque");
    expect(texto).toContain("Marca: Apple");
    expect(texto).toContain("Categoria: Smartphones");
  });

  it("formata produto com estoque sem controle rígido", () => {
    const texto = formatCatalogProductForRag({
      codigo: "SRV-INST",
      nome: "Instalação Padrão",
      preco_cents: 15000,
      quantidade: 0,
      controla_estoque: false,
    });

    expect(texto).toContain("Produto: Instalação Padrão");
    expect(texto).toContain("Disponibilidade / Estoque: Disponível (sem controle rígido de quantidade)");
    expect(texto).not.toContain("Marca:");
    expect(texto).not.toContain("Categoria:");
  });
});

describe("Google Sheets Stock Sync — Planilha Parsing & Delta Compatibility", () => {
  it("processa CSV vindo da planilha com colunas padrão de estoque", () => {
    const csvContent = [
      "codigo,nome,marca,categoria,preco,estoque",
      "P1,Camiseta Básica,Kortex Wear,Vestuário,79.90,25",
      "P2,Tênis Runner,SportPro,Calçados,299.00,10",
    ].join("\n");

    const resultado = lerPlanilha(csvContent);
    expect("produtos" in resultado).toBe(true);

    if ("produtos" in resultado) {
      expect(resultado.produtos).toHaveLength(2);
      expect(resultado.erros).toHaveLength(0);

      const p1 = resultado.produtos[0]!;
      expect(p1.codigo).toBe("P1");
      expect(p1.nome).toBe("Camiseta Básica");
      expect(p1.preco_cents).toBe(7990);
      expect(p1.quantidade).toBe(25);
      expect(p1.controla_estoque).toBe(true);

      const p2 = resultado.produtos[1]!;
      expect(p2.codigo).toBe("P2");
      expect(p2.preco_cents).toBe(29900);
      expect(p2.quantidade).toBe(10);
    }
  });

  it("processa e identifica erros em linhas com valores inválidos sem derrubar o restante", () => {
    const csvContent = [
      "sku,produto,preco,quantidade",
      "A1,Mouse Sem Fio,59.90,15",
      "A2,Teclado Mecânico,VALOR_INVALIDO,8",
      "A3,,19.90,50",
    ].join("\n");

    const resultado = lerPlanilha(csvContent);
    expect("produtos" in resultado).toBe(true);

    if ("produtos" in resultado) {
      expect(resultado.produtos).toHaveLength(1);
      expect(resultado.produtos[0]?.codigo).toBe("A1");
      expect(resultado.erros).toHaveLength(2);
      expect(resultado.erros[0]?.linha).toBe(3); // Teclado com preço inválido
      expect(resultado.erros[1]?.linha).toBe(4); // Produto sem nome
    }
  });
});

describe("Google Sheets Stock Sync — Concorrência, Retry e Tratamento de Erro 40001", () => {
  it("detecta corretamente erros de serialização 40001 e concorrência", async () => {
    const { isSerializationOrConcurrencyError } = await import(
      "@/lib/integrations/google-sheets/sync"
    );

    // Erros com código 40001 e 40P01
    expect(isSerializationOrConcurrencyError({ code: "40001", message: "serialization failure" })).toBe(true);
    expect(isSerializationOrConcurrencyError({ code: "40P01", message: "deadlock detected" })).toBe(true);

    // Erros com tag google_stale
    expect(isSerializationOrConcurrencyError({ message: "error: google_stale" })).toBe(true);
    expect(isSerializationOrConcurrencyError(new Error("PostgreSQL: google_stale revision conflict"))).toBe(true);

    // Erros com texto de serialização ou deadlock
    expect(isSerializationOrConcurrencyError({ message: "could not serialize access due to concurrent update" })).toBe(true);
    expect(isSerializationOrConcurrencyError({ details: "serialization_failure on table catalog_products" })).toBe(true);

    // Erros comuns que NÃO são de serialização (validação, sintaxe, etc.)
    expect(isSerializationOrConcurrencyError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isSerializationOrConcurrencyError({ code: "42P01", message: "relation does not exist" })).toBe(false);
    expect(isSerializationOrConcurrencyError(new Error("Network timeout"))).toBe(false);
    expect(isSerializationOrConcurrencyError(null)).toBe(false);
    expect(isSerializationOrConcurrencyError(undefined)).toBe(false);
  });

  it("upsertLoteComRetry retenta após erro 40001 e tem sucesso quando a tentativa seguinte passa", async () => {
    const { upsertLoteComRetry } = await import("@/lib/integrations/google-sheets/sync");

    let tentativas = 0;
    const adminMock = {
      from: () => ({
        upsert: async () => {
          tentativas++;
          if (tentativas === 1) {
            return { error: { code: "40001", message: "google_stale" } };
          }
          return { error: null };
        },
      }),
    };

    const res = await upsertLoteComRetry(
      adminMock as never,
      [{ codigo: "SKU-1", nome: "Item 1" }],
      3,
      10, // delay curto para teste unitário
    );

    expect(res.ok).toBe(true);
    expect(tentativas).toBe(2);
  });

  it("upsertLoteComRetry aborta com isSerialization=true se o erro 40001 esgotar as tentativas", async () => {
    const { upsertLoteComRetry } = await import("@/lib/integrations/google-sheets/sync");

    let tentativas = 0;
    const adminMock = {
      from: () => ({
        upsert: async () => {
          tentativas++;
          return { error: { code: "40001", message: "could not serialize access" } };
        },
      }),
    };

    const res = await upsertLoteComRetry(
      adminMock as never,
      [{ codigo: "SKU-1", nome: "Item 1" }],
      3,
      10,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.isSerialization).toBe(true);
    }
    expect(tentativas).toBe(3);
  });

  it("upsertLoteComRetry não retenta erros de dados não-concorrentes (isSerialization=false)", async () => {
    const { upsertLoteComRetry } = await import("@/lib/integrations/google-sheets/sync");

    let tentativas = 0;
    const adminMock = {
      from: () => ({
        upsert: async () => {
          tentativas++;
          return { error: { code: "23502", message: "not-null constraint violation" } };
        },
      }),
    };

    const res = await upsertLoteComRetry(
      adminMock as never,
      [{ codigo: "SKU-1", nome: "Item 1" }],
      3,
      10,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.isSerialization).toBe(false);
    }
    expect(tentativas).toBe(1); // Aborta na primeira tentativa sem retentar
  });
});
