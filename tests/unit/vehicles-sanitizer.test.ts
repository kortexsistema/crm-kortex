import { describe, expect, it } from "vitest";
import {
  mascararChassi,
  mascararPlaca,
  sanitizarVeiculoParaVisualizacao,
} from "@/lib/vehicles/sanitizer";
import type { VehicleParsed } from "@/lib/vehicles/types";

describe("Sanitização e Mascaramento de Veículos (lib/vehicles/sanitizer)", () => {
  describe("mascararPlaca", () => {
    it("mascara placa Mercosul preservando os 3 primeiros e o último caractere", () => {
      expect(mascararPlaca("ABC1D23")).toBe("ABC***3");
    });

    it("mascara placa formato antigo (ABC1234)", () => {
      expect(mascararPlaca("ABC1234")).toBe("ABC***4");
    });

    it("lida com placa curta ou incompleta", () => {
      expect(mascararPlaca("1234")).toBe("***4");
    });

    it("retorna null para valores ausentes", () => {
      expect(mascararPlaca(null)).toBeNull();
      expect(mascararPlaca(undefined)).toBeNull();
      expect(mascararPlaca("")).toBeNull();
    });
  });

  describe("mascararChassi", () => {
    it("mascara chassi de 17 caracteres preservando WMI (3 primeiros) e VIS final (4 últimos)", () => {
      const chassi = "9BWZZZ377VT004251";
      const mascarado = mascararChassi(chassi);
      expect(mascarado).toBe("9BW**********4251");
      expect(mascarado).not.toContain("ZZZ377VT");
    });

    it("retorna null para valores ausentes", () => {
      expect(mascararChassi(null)).toBeNull();
      expect(mascararChassi(undefined)).toBeNull();
      expect(mascararChassi("")).toBeNull();
    });
  });

  describe("sanitizarVeiculoParaVisualizacao", () => {
    it("NUNCA expõe placa_completa, chassi, custos ou observações internas", () => {
      const veiculo: VehicleParsed = {
        linha: 2,
        marca: "Honda",
        modelo: "Civic",
        versao: "Touring 1.5 Turbo",
        ano_fabricacao: 2021,
        ano_modelo: 2021,
        cor: "Preto",
        combustivel: "gasolina",
        cambio: "cvt",
        quilometragem: 45000,
        preco_cents: 14500000,
        moeda: "BRL",
        status: "disponivel",
        opcionais: ["teto solar", "couro"],
        fotos_urls: ["https://exemplo.com/foto1.jpg"],
        placa_final: "3",
        // Campos confidenciais internos:
        placa_completa: "ABC1D23",
        chassi: "9BWZZZ377VT004251",
        custo_aquisicao_cents: 12000000,
        custo_preparacao_cents: 350000,
        observacoes_internas: "Cliente trocou na concessionária; parachoque dianteiro repintado.",
      };

      const seguro = sanitizarVeiculoParaVisualizacao(veiculo);

      // Campos comerciais preservados
      expect(seguro.marca).toBe("Honda");
      expect(seguro.modelo).toBe("Civic");
      expect(seguro.versao).toBe("Touring 1.5 Turbo");
      expect(seguro.preco_cents).toBe(14500000);
      expect(seguro.quilometragem).toBe(45000);
      expect(seguro.placa_final).toBe("3");

      // Campos mascarados
      expect(seguro.placa_mascarada).toBe("ABC***3");
      expect(seguro.chassi_mascarado).toBe("9BW**********4251");

      // Campos confidenciais estritamente ausentes
      expect((seguro as unknown as Record<string, unknown>).placa_completa).toBeUndefined();
      expect((seguro as unknown as Record<string, unknown>).chassi).toBeUndefined();
      expect((seguro as unknown as Record<string, unknown>).custo_aquisicao_cents).toBeUndefined();
      expect((seguro as unknown as Record<string, unknown>).custo_preparacao_cents).toBeUndefined();
      expect((seguro as unknown as Record<string, unknown>).observacoes_internas).toBeUndefined();
    });
  });
});
