import { parseCsv } from "@/lib/contacts/csv";
import { parseExcel } from "@/lib/sheets/excel";
import { precoParaCentavos } from "@/lib/schemas/produtos";
import type {
  VehicleCambio,
  VehicleCombustivel,
  VehicleDuplicate,
  VehicleParsed,
  VehiclePreviewReport,
  VehicleRowError,
  VehicleStatus,
} from "./types";

/**
 * Normaliza cabeçalho retirando acentos, espaços extras e caixa alta.
 */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dicionário de sinônimos de colunas para planilhas automotivas */
const COLUNAS_CONHECIDAS: Record<string, readonly string[]> = {
  marca: ["marca", "fabricante", "montadora", "make"],
  modelo: ["modelo", "veiculo", "veiculo", "carro", "auto", "model"],
  versao: ["versao", "versao", "submodelo", "acabamento", "version", "trim"],
  ano_composto: ["ano", "exercicio"],
  ano_fabricacao: [
    "ano de fabricacao",
    "ano fabricacao",
    "ano fabricacao",
    "ano fab",
    "ano fab.",
    "anofab",
    "year fab",
  ],
  ano_modelo: [
    "ano do modelo",
    "ano modelo",
    "ano mod",
    "ano mod.",
    "anomod",
    "year model",
  ],
  cor: ["cor", "pintura", "color"],
  combustivel: ["combustivel", "combustivel", "propulsao", "fuel"],
  cambio: ["cambio", "cambio", "transmissao", "transmissao", "transmission"],
  quilometragem: ["quilometragem", "km", "rodagem", "odometro", "odometro", "mileage"],
  preco: [
    "preco",
    "preco",
    "valor",
    "venda",
    "preco de venda",
    "preco de venda",
    "valor de venda",
    "price",
  ],
  custo: [
    "custo",
    "preco de custo",
    "preco de custo",
    "compra",
    "valor de compra",
    "custo aquisicao",
    "custo aquisicao",
  ],
  custo_preparacao: [
    "custo preparacao",
    "custo preparacao",
    "preparacao",
    "preparacao",
    "reparos",
    "oficina",
  ],
  status: ["status", "situacao", "situacao", "estado"],
  placa: ["placa", "placa completa", "placa veiculo"],
  chassi: ["chassi", "vin", "numero chassi", "numero de chassi"],
  opcionais: [
    "opcionais",
    "acessorios",
    "acessorios",
    "itens",
    "equipamentos",
    "detalhes",
    "features",
  ],
  fotos: ["fotos", "foto", "imagens", "links fotos", "urls fotos", "photos"],
  observacoes: [
    "observacoes",
    "observacoes",
    "obs",
    "observacao",
    "observacao",
    "detalhes internos",
    "avarias",
    "notas",
  ],
};

function identificarCampo(cabecalho: string): string | null {
  const cabecalhoOriginal = cabecalho.trim().toLowerCase();
  // Se o título contiver barra e a palavra "ano" (ex: "Ano/Mod", "Ano/Fab", "Ano / Modelo"), é ano composto
  if (cabecalhoOriginal.includes("/") && cabecalhoOriginal.includes("ano")) {
    return "ano_composto";
  }

  const alvo = normalizarTexto(cabecalho);
  for (const [campo, formas] of Object.entries(COLUNAS_CONHECIDAS)) {
    if (formas.some((f) => normalizarTexto(f) === alvo)) {
      return campo;
    }
  }
  return null;
}

/**
 * Normaliza ano(s). Suporta números puros ("2021") e formatos compostos ("2020/2021", "20/21").
 */
function normalizarAnos(
  anoFabStr?: string,
  anoModStr?: string,
  anoCompostoStr?: string,
): { ano_fabricacao: number | null; ano_modelo: number | null } {
  let fab: number | null = null;
  let mod: number | null = null;

  // Se qualquer campo contiver barra (ex: "2020/2021"), trata como composto
  let composto = anoCompostoStr?.trim();
  if (!composto) {
    if (anoFabStr && anoFabStr.includes("/")) {
      composto = anoFabStr.trim();
      anoFabStr = undefined;
    } else if (anoModStr && anoModStr.includes("/")) {
      composto = anoModStr.trim();
      anoModStr = undefined;
    }
  }

  const parseAnoIndividual = (val: string): number | null => {
    const digits = val.replace(/\D/g, "");
    if (!digits) return null;
    const n = parseInt(digits, 10);
    if (n >= 1900 && n <= 2100) return n;
    if (n >= 0 && n <= 99) {
      return n > 50 ? 1900 + n : 2000 + n;
    }
    return null;
  };

  if (composto && composto.includes("/")) {
    const partes = composto.split("/").map((p) => p.trim());
    if (partes[0]) fab = parseAnoIndividual(partes[0]);
    if (partes[1]) mod = parseAnoIndividual(partes[1]);
  } else if (composto) {
    const n = parseAnoIndividual(composto);
    if (n !== null) {
      fab = n;
      mod = n;
    }
  }

  if (anoFabStr && fab === null) fab = parseAnoIndividual(anoFabStr);
  if (anoModStr && mod === null) mod = parseAnoIndividual(anoModStr);

  // Se houver apenas uma coluna de ano na planilha (a outra é undefined) e um ano único foi informado,
  // preenche ambos os anos (ex: "2022" em coluna única -> 2022/2022)
  if (fab === null && mod !== null && anoFabStr === undefined) {
    fab = mod;
  }
  if (mod === null && fab !== null && anoModStr === undefined) {
    mod = fab;
  }

  return { ano_fabricacao: fab, ano_modelo: mod };
}

/**
 * Normaliza tipo de combustível conforme constraint do banco.
 */
function normalizarCombustivel(val?: string): VehicleCombustivel | null {
  if (!val || val.trim() === "") return null;
  const texto = normalizarTexto(val);

  if (texto.includes("flex") || texto.includes("bi fuel") || (texto.includes("gas") && texto.includes("alc"))) {
    return "flex";
  }
  if (texto.includes("diesel")) return "diesel";
  if (texto.includes("gasolina")) return "gasolina";
  if (texto.includes("etanol") || texto.includes("alcool")) return "etanol";
  if (texto.includes("eletrico") || texto.includes("ev")) return "eletrico";
  if (texto.includes("hibrid")) return "hibrido";
  if (texto.includes("gnv") || texto.includes("gas natural")) return "gnv";

  return "outro";
}

/**
 * Normaliza tipo de câmbio conforme constraint do banco.
 */
function normalizarCambio(val?: string): VehicleCambio | null {
  if (!val || val.trim() === "") return null;
  const texto = normalizarTexto(val);

  if (texto.includes("man") || texto.includes("mec")) return "manual";
  if (texto.includes("cvt")) return "cvt";
  if (texto.includes("automatiz") || texto.includes("motion") || texto.includes("dualogic")) {
    return "automatizado";
  }
  if (texto.includes("aut")) return "automatico";

  return "outro";
}

/**
 * Normaliza quilometragem para número inteiro.
 * IMPORTANTE: Se ausente ou vazio, devolve null (NUNCA zero!).
 */
function normalizarQuilometragem(val?: string): { km: number | null; erro?: string } {
  if (!val || val.trim() === "") return { km: null };
  const limpo = val.replace(/\u00A0/g, " ").replace(/km/gi, "").trim();
  if (limpo === "") return { km: null };

  // Remove pontos de milhar caso existam (ex: 45.000 -> 45000)
  const semPontos = limpo.replace(/\./g, "").replace(/,/g, ".");
  const num = Number(semPontos);

  if (isNaN(num) || num < 0) {
    return { km: null, erro: `Quilometragem inválida: "${val}"` };
  }

  return { km: Math.round(num) };
}

/**
 * Normaliza status do veículo.
 */
function normalizarStatus(val?: string): VehicleStatus {
  if (!val || val.trim() === "") return "disponivel";
  const texto = normalizarTexto(val);

  if (texto.includes("disp") || texto.includes("estoque") || texto.includes("livre") || texto.includes("ativo")) {
    return "disponivel";
  }
  if (texto.includes("res") || texto.includes("negoc")) {
    return "reservado";
  }
  if (texto.includes("vend")) {
    return "vendido";
  }
  if (texto.includes("prep") || texto.includes("ofic") || texto.includes("repar")) {
    return "em_preparacao";
  }

  return "disponivel";
}

/**
 * Extrai placa completa e placa_final.
 */
function normalizarPlaca(val?: string): { placa_completa: string | null; placa_final: string | null } {
  if (!val || val.trim() === "") return { placa_completa: null, placa_final: null };
  const limpo = val.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!limpo) return { placa_completa: null, placa_final: null };

  const final = limpo[limpo.length - 1] ?? null;
  return { placa_completa: limpo, placa_final: final };
}

/**
 * Parser e validador principal de planilhas de veículos.
 * Aceita Buffer, ArrayBuffer, CSV ou string[][].
 */
export async function lerPlanilhaVeiculos(
  conteudo: Buffer | ArrayBuffer | Uint8Array | string | string[][],
): Promise<VehiclePreviewReport> {
  let linhas: string[][] = [];

  if (Array.isArray(conteudo)) {
    linhas = conteudo;
  } else if (typeof conteudo === "string") {
    linhas = parseCsv(conteudo);
  } else {
    // Tenta carregar como Excel XLSX
    try {
      linhas = await parseExcel(conteudo);
    } catch {
      // Fallback para CSV decodificado em UTF-8 se não for zip/xlsx
      const texto = Buffer.isBuffer(conteudo)
        ? conteudo.toString("utf8")
        : new TextDecoder("utf-8").decode(conteudo);
      linhas = parseCsv(texto);
    }
  }

  // Remove linhas totalmente vazias
  const linhasNaoVazias = linhas.filter((l) => l.some((c) => c && c.trim() !== ""));

  if (linhasNaoVazias.length === 0) {
    return {
      totalLinhas: 0,
      veiculosValidos: [],
      duplicatas: [],
      erros: [{ linha: 1, motivo: "A planilha está vazia ou não contém dados válidos." }],
      colunasDetectadas: {},
      colunasIgnoradas: [],
    };
  }

  const cabecalho = linhasNaoVazias[0]!;
  const indiceParaCampo = new Map<number, string>();
  const colunasDetectadas: Record<string, string> = {};
  const colunasIgnoradas: string[] = [];

  cabecalho.forEach((titulo, i) => {
    const campo = identificarCampo(titulo);
    if (campo) {
      indiceParaCampo.set(i, campo);
      colunasDetectadas[campo] = titulo.trim();
    } else if (titulo && titulo.trim() !== "") {
      colunasIgnoradas.push(titulo.trim());
    }
  });

  // Validação mínima de colunas indispensáveis
  const camposDetectados = new Set(indiceParaCampo.values());
  const errosGerais: VehicleRowError[] = [];

  if (!camposDetectados.has("modelo")) {
    errosGerais.push({
      linha: 1,
      motivo: 'Coluna obrigatória de identificação do modelo não encontrada (ex: "Modelo", "Veículo", "Carro").',
    });
  }

  if (errosGerais.length > 0) {
    return {
      totalLinhas: linhasNaoVazias.length - 1,
      veiculosValidos: [],
      duplicatas: [],
      erros: errosGerais,
      colunasDetectadas,
      colunasIgnoradas,
    };
  }

  const veiculosValidos: VehicleParsed[] = [];
  const duplicatas: VehicleDuplicate[] = [];
  const erros: VehicleRowError[] = [];

  // Rastreamento para deduplicação interna
  const chassisVistos = new Map<string, number>();
  const placasVistas = new Map<string, number>();

  // Processa as linhas de dados (linha 1 = cabeçalho, dados começam na linha 2)
  for (let idx = 1; idx < linhasNaoVazias.length; idx++) {
    const linhaNum = idx + 1;
    const linha = linhasNaoVazias[idx]!;

    const valores: Record<string, string> = {};
    linha.forEach((valor, colIdx) => {
      const campo = indiceParaCampo.get(colIdx);
      if (campo) {
        valores[campo] = valor?.trim() ?? "";
      }
    });

    const modelo = valores["modelo"]?.trim();
    const marca = valores["marca"]?.trim() || "";

    if (!modelo) {
      erros.push({
        linha: linhaNum,
        campo: "modelo",
        motivo: "Modelo do veículo não preenchido na linha.",
      });
      continue;
    }

    // Normalização de Anos
    const { ano_fabricacao, ano_modelo } = normalizarAnos(
      valores["ano_fabricacao"],
      valores["ano_modelo"],
      valores["ano_composto"],
    );

    // Normalização de Câmbio e Combustível
    const cambio = normalizarCambio(valores["cambio"]);
    const combustivel = normalizarCombustivel(valores["combustivel"]);

    // Quilometragem (NULL quando ausente, sem default 0)
    const { km, erro: erroKm } = normalizarQuilometragem(valores["quilometragem"]);
    if (erroKm) {
      erros.push({ linha: linhaNum, campo: "quilometragem", motivo: erroKm });
      continue;
    }

    // Preço (NULL quando ausente, sem default 0)
    let preco_cents: number | null = null;
    if (valores["preco"] && valores["preco"].trim() !== "") {
      const cents = precoParaCentavos(valores["preco"]);
      if (cents === null) {
        erros.push({
          linha: linhaNum,
          campo: "preco",
          motivo: `Preço em formato inválido ou ambíguo: "${valores["preco"]}"`,
        });
        continue;
      }
      preco_cents = cents;
    }

    // Custos internos
    let custo_aquisicao_cents: number | null = null;
    if (valores["custo"] && valores["custo"].trim() !== "") {
      custo_aquisicao_cents = precoParaCentavos(valores["custo"]);
    }

    let custo_preparacao_cents: number | null = null;
    if (valores["custo_preparacao"] && valores["custo_preparacao"].trim() !== "") {
      custo_preparacao_cents = precoParaCentavos(valores["custo_preparacao"]);
    }

    // Placa e Chassi
    const { placa_completa, placa_final } = normalizarPlaca(valores["placa"]);
    const chassi = valores["chassi"]?.trim().toUpperCase() || null;

    // Deduplicação por Chassi
    if (chassi) {
      if (chassisVistos.has(chassi)) {
        const linhaAnterior = chassisVistos.get(chassi)!;
        duplicatas.push({
          linha: linhaNum,
          linhaConflitante: linhaAnterior,
          tipo: "chassi",
          identificador: chassi,
          mensagem: `Chassi "${chassi}" já informado na linha ${linhaAnterior}.`,
        });
        continue;
      }
      chassisVistos.set(chassi, linhaNum);
    }

    // Deduplicação por Placa Completa
    if (placa_completa) {
      if (placasVistas.has(placa_completa)) {
        const linhaAnterior = placasVistas.get(placa_completa)!;
        duplicatas.push({
          linha: linhaNum,
          linhaConflitante: linhaAnterior,
          tipo: "placa",
          identificador: placa_completa,
          mensagem: `Placa "${placa_completa}" já informada na linha ${linhaAnterior}.`,
        });
        continue;
      }
      placasVistas.set(placa_completa, linhaNum);
    }

    // Opcionais
    const opcionais = valores["opcionais"]
      ? valores["opcionais"]
          .split(/[,;/]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // Fotos
    const fotos_urls = valores["fotos"]
      ? valores["fotos"]
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const status = normalizarStatus(valores["status"]);

    const veiculo: VehicleParsed = {
      linha: linhaNum,
      marca: marca || "Não Informada",
      modelo,
      versao: valores["versao"]?.trim() || null,
      ano_fabricacao,
      ano_modelo,
      cor: valores["cor"]?.trim() || null,
      combustivel,
      cambio,
      quilometragem: km,
      preco_cents,
      moeda: "BRL",
      status,
      opcionais,
      fotos_urls,
      placa_final,
      placa_completa,
      chassi,
      custo_aquisicao_cents,
      custo_preparacao_cents,
      observacoes_internas: valores["observacoes"]?.trim() || null,
    };

    veiculosValidos.push(veiculo);
  }

  return {
    totalLinhas: linhasNaoVazias.length - 1,
    veiculosValidos,
    duplicatas,
    erros,
    colunasDetectadas,
    colunasIgnoradas,
  };
}

export { lerPlanilhaVeiculos as parseVehicleSpreadsheet };

