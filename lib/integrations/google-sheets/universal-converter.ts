/**
 * Conversor Universal de Planilhas para Documento de Conhecimento RAG.
 *
 * Converte qualquer planilha tabular (veículos, produtos, planos, serviços)
 * em um documento de texto estruturado, legível e contextualizado, idêntico
 * ao formato que operadores preenchem manualmente no acervo de IA.
 *
 * Exemplo gerado:
 * # BASE DE CONHECIMENTO - ESTOQUE
 *
 * ## MOTOS E ELÉTRICOS
 * SHINERAY SE1: 2022/2022, Cinza, Placa: FPQ-0E35, Preço: R$ 10.900,00, Combustível: Elétrico.
 * BIZ 125: 2019/2019, Branca, Placa: DMB-2B30, Combustível: Flex.
 *
 * ## IMPORTADOS
 * BYD DOLPHIN 0km: 2026/2027, Preta, Placa: UJD-4F34, Preço: R$ 149.900,00, Combustível: Elétrico.
 */

import { parseCsv } from "@/lib/contacts/csv";

export interface UniversalConvertOptions {
  titulo?: string;
  agruparPor?: string; // Coluna opcional para agrupar (ex: marca, categoria, tipo)
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Tenta identificar qual o papel de cada coluna */
function identificarPapelDaColuna(nomeOriginal: string): string {
  const norm = normalizar(nomeOriginal);

  // Coluna de identificação / nome principal
  if (
    norm === "modelo" ||
    norm === "veiculo" ||
    norm === "veículo" ||
    norm === "produto" ||
    norm === "nome" ||
    norm === "item" ||
    norm === "titulo" ||
    norm === "título" ||
    norm === "descricao" ||
    norm === "descrição" ||
    norm === "carro" ||
    norm === "moto" ||
    norm === "servico" ||
    norm === "serviço"
  ) {
    return "nome_principal";
  }

  // Coluna de agrupamento (marca, categoria, tipo, grupo, secao)
  if (
    norm === "marca" ||
    norm === "fabricante" ||
    norm === "categoria" ||
    norm === "tipo" ||
    norm === "secao" ||
    norm === "seção" ||
    norm === "grupo" ||
    norm === "departamento" ||
    norm === "classificacao" ||
    norm === "classificação"
  ) {
    return "grupo";
  }

  // Preço / Valor
  if (
    norm === "preco" ||
    norm === "preço" ||
    norm === "valor" ||
    norm === "preco de venda" ||
    norm === "preço de venda" ||
    norm === "venda" ||
    norm === "preco_venda" ||
    norm === "vlr" ||
    norm === "val"
  ) {
    return "preco";
  }

  // Placa
  if (norm === "placa" || norm === "placas") {
    return "placa";
  }

  // Ano / Modelo
  if (
    norm === "ano" ||
    norm === "ano/modelo" ||
    norm === "ano modelo" ||
    norm === "ano_modelo" ||
    norm === "ano fab" ||
    norm === "ano fabricacao" ||
    norm === "ano/mod" ||
    norm === "ano_mod"
  ) {
    return "ano";
  }

  // Combustível
  if (norm === "combustivel" || norm === "combustível" || norm === "comb") {
    return "combustivel";
  }

  // Cor
  if (norm === "cor" || norm === "cores" || norm === "color") {
    return "cor";
  }

  // Km / Quilometragem
  if (
    norm === "km" ||
    norm === "quilometragem" ||
    norm === "km rodados" ||
    norm === "rodagem"
  ) {
    return "km";
  }

  // Estoque / Quantidade
  if (norm === "estoque" || norm === "quantidade" || norm === "qtd" || norm === "qtde") {
    return "estoque";
  }

  // Código / SKU
  if (norm === "codigo" || norm === "código" || norm === "sku" || norm === "ref") {
    return "codigo";
  }

  // Observações / Detalhes
  if (
    norm === "obs" ||
    norm === "observacao" ||
    norm === "observação" ||
    norm === "observacoes" ||
    norm === "observações" ||
    norm === "detalhes" ||
    norm === "situacao" ||
    norm === "situação" ||
    norm === "status"
  ) {
    return "observacao";
  }

  return "atributo_geral";
}

function formatarPreco(valorBruto: string): string {
  const v = valorBruto.trim();
  if (!v) return "";
  if (/^r\$/i.test(v)) return v;

  let num: number | null = null;
  const semSimbolo = v.replace(/[^\d.,]/g, "").trim();

  if (semSimbolo.includes(".") && semSimbolo.includes(",")) {
    if (semSimbolo.lastIndexOf(",") > semSimbolo.lastIndexOf(".")) {
      // 149.900,00
      num = parseFloat(semSimbolo.replace(/\./g, "").replace(",", "."));
    } else {
      // 149,900.00
      num = parseFloat(semSimbolo.replace(/,/g, ""));
    }
  } else if (semSimbolo.includes(".")) {
    const partes = semSimbolo.split(".");
    const ultimaParte = partes[partes.length - 1]!;
    if (partes.length === 2 && ultimaParte.length <= 2) {
      // 79.90 ou 149900.00
      num = parseFloat(semSimbolo);
    } else {
      // 10.900 ou 149.900 (milhar)
      num = parseFloat(semSimbolo.replace(/\./g, ""));
    }
  } else if (semSimbolo.includes(",")) {
    num = parseFloat(semSimbolo.replace(",", "."));
  } else if (/^\d+$/.test(semSimbolo)) {
    num = parseFloat(semSimbolo);
  }

  if (num !== null && !isNaN(num)) {
    const formatado = num.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `R$ ${formatado}`;
  }

  return `R$ ${v}`;
}

export function converterLinhasEmTextoUniversal(
  linhasOuCsv: string | string[][],
  opcoes?: UniversalConvertOptions,
): { markdown: string; totalLinhas: number } {
  let matriz: string[][];
  if (typeof linhasOuCsv === "string") {
    // Detecta se é separado por tabulação (\t) ou vírgula/ponto-e-vírgula
    matriz = parseCsv(linhasOuCsv);
  } else {
    matriz = linhasOuCsv;
  }

  matriz = matriz.filter((l) => l.some((c) => c && c.trim() !== ""));

  if (matriz.length < 2) {
    return {
      markdown: "# BASE DE CONHECIMENTO\n\nNenhum dado encontrado na planilha.",
      totalLinhas: 0,
    };
  }

  const cabecalho = matriz[0]!;
  const dados = matriz.slice(1);

  // Mapeia os índices de colunas especiais
  const papeis: string[] = cabecalho.map((col) => identificarPapelDaColuna(col));
  const idxNome = papeis.indexOf("nome_principal");
  const idxGrupo = papeis.indexOf("grupo");

  // Agrupamento por seção/grupo (ex: Marca ou Categoria)
  const grupos = new Map<string, string[]>();
  let grupoCorrente = "GERAL";

  for (const row of dados) {
    // Se a linha estiver vazia, pula
    if (row.every((c) => !c || c.trim() === "")) continue;

    // Detecta se a linha é uma linha separadora / cabeçalho de seção (ex: "MOTOS E ELÉTRICOS", "IMPORTADOS", "HONDA")
    const preenchidas = row.filter((c) => c && c.trim() !== "");
    if (preenchidas.length === 1) {
      const textoSecao = preenchidas[0]!.trim();
      // Não é ano nem placa nem valor numérico
      if (
        textoSecao.length > 2 &&
        !/^\d{4}(\/\d{4})?$/.test(textoSecao) &&
        !/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/i.test(textoSecao) &&
        !/^R?\$?\s*[\d.,]+$/i.test(textoSecao)
      ) {
        grupoCorrente = textoSecao.toUpperCase();
        continue;
      }
    }

    // Determina o grupo/seção da linha
    let grupoNome = grupoCorrente;
    if (idxGrupo >= 0 && row[idxGrupo]?.trim()) {
      grupoNome = row[idxGrupo]!.trim().toUpperCase();
    }

    // Identifica o nome ou título principal do item
    let nomePrincipal = "";
    if (idxNome >= 0 && row[idxNome]?.trim()) {
      nomePrincipal = row[idxNome]!.trim();
    } else {
      // Pega a primeira coluna não vazia
      const primeiroValor = row.find((c) => c && c.trim() !== "");
      nomePrincipal = primeiroValor?.trim() || "Item";
    }

    // Coleta atributos mapeados para ordem canônica
    let ano = "";
    let cor = "";
    let placa = "";
    let preco = "";
    let combustivel = "";
    let km = "";
    let estoque = "";
    let observacao = "";
    const outrosAtributos: string[] = [];

    for (let c = 0; c < cabecalho.length; c++) {
      if (c === idxNome || c === idxGrupo) continue; // Já usados no título/seção

      const colTitulo = cabecalho[c]?.trim() || "";
      const valor = row[c]?.trim() || "";
      if (!valor) continue;

      const papel = papeis[c];

      if (papel === "preco") {
        preco = formatarPreco(valor);
      } else if (papel === "placa") {
        placa = valor.toUpperCase();
      } else if (papel === "combustivel") {
        combustivel = valor;
      } else if (papel === "ano") {
        ano = valor.includes("/") ? valor : `${valor}/${valor}`;
      } else if (papel === "cor") {
        cor = valor;
      } else if (papel === "km") {
        km = valor;
      } else if (papel === "estoque") {
        estoque = valor;
      } else if (papel === "observacao") {
        observacao = valor;
      } else {
        outrosAtributos.push(`${colTitulo}: ${valor}`);
      }
    }

    // Monta atributos no formato limpo e universal dos operadores
    const atributos: string[] = [];
    if (ano) atributos.push(ano);
    if (cor) atributos.push(cor);
    if (placa) atributos.push(`Placa: ${placa}`);
    if (preco) atributos.push(`Preço: ${preco}`);
    if (combustivel) atributos.push(`Combustível: ${combustivel}`);
    if (km) atributos.push(`KM: ${km}`);
    if (estoque) atributos.push(`Estoque: ${estoque}`);
    if (observacao) atributos.push(observacao);
    if (outrosAtributos.length > 0) atributos.push(...outrosAtributos);

    const linhaFormatada =
      atributos.length > 0
        ? `${nomePrincipal}: ${atributos.join(", ")}.`
        : `${nomePrincipal}.`;

    if (!grupos.has(grupoNome)) {
      grupos.set(grupoNome, []);
    }
    grupos.get(grupoNome)!.push(linhaFormatada);
  }

  // Constrói o texto final Markdown
  const titulo = opcoes?.titulo || "BASE DE CONHECIMENTO - ESTOQUE";
  const blocos: string[] = [`# ${titulo}\n`];

  // Se houver apenas o grupo "GERAL", não cria subtítulos desnecessários
  const apenasGeral = grupos.size === 1 && grupos.has("GERAL");

  for (const [grupo, itens] of grupos.entries()) {
    if (!apenasGeral) {
      blocos.push(`\n## ${grupo}\n`);
    }
    for (const item of itens) {
      blocos.push(`${item}\n`);
    }
  }

  return {
    markdown: blocos.join("").trim(),
    totalLinhas: dados.length,
  };
}
