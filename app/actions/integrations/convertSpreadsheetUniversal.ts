"use server";

import { generateText } from "ai";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { decodificarCsv, parseCsv } from "@/lib/contacts/csv";
import { parseExcel } from "@/lib/sheets/excel";
import { normalizeGoogleSheetsUrl } from "@/lib/integrations/google-sheets/url";
import {
  converterLinhasEmTextoUniversal,
  type UniversalConvertOptions,
} from "@/lib/integrations/google-sheets/universal-converter";
import { resolveLanguageModel, DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";

const FETCH_TIMEOUT_MS = 15_000;

export interface ConvertSpreadsheetUniversalParams {
  origem: "google_sheets" | "arquivo" | "texto";
  sheetUrl?: string;
  sheetGid?: string;
  fileBase64?: string;
  fileName?: string;
  rawText?: string;
  customTitle?: string;
  usarIa?: boolean;
}

export async function convertSpreadsheetUniversal(
  params: ConvertSpreadsheetUniversalParams,
): Promise<
  | {
      ok: true;
      data: {
        markdown: string;
        totalLinhas: number;
        tituloSugerido: string;
        metodo: "algoritmo_universal" | "ia";
      };
    }
  | { ok: false; error: { message: string } }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: { message: "Autenticação necessária." } };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: { message: "Sem organização ativa." } };

  let linhasOuCsv: string | string[][] = "";

  try {
    if (params.origem === "google_sheets") {
      const urlToUse = params.sheetUrl?.trim();
      if (!urlToUse) {
        return { ok: false, error: { message: "Informe a URL da Planilha Google." } };
      }

      const norm = normalizeGoogleSheetsUrl(urlToUse, params.sheetGid?.trim());
      if (!norm.ok) {
        return { ok: false, error: { message: norm.error } };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(norm.data.exportCsvUrl, {
        signal: controller.signal,
        headers: {
          Accept: "text/csv, text/plain, */*",
          "User-Agent": "Kortex-Converter/1.0",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const msg =
          res.status === 403 || res.status === 401
            ? "Acesso negado à planilha. Altere o compartilhamento no Google Sheets para 'Qualquer pessoa com o link pode ler'."
            : res.status === 404
              ? "Planilha não encontrada. Verifique se o link está correto."
              : `Google Sheets respondeu com status ${res.status}.`;
        return { ok: false, error: { message: msg } };
      }

      const arrayBuf = await res.arrayBuffer();
      const decodificado = decodificarCsv(arrayBuf);
      if ("erro" in decodificado) {
        return { ok: false, error: { message: decodificado.erro } };
      }
      linhasOuCsv = decodificado.texto;
    } else if (params.origem === "arquivo") {
      if (!params.fileBase64) {
        return { ok: false, error: { message: "Arquivo não enviado." } };
      }

      const buffer = Buffer.from(params.fileBase64, "base64");
      const nomeArquivo = (params.fileName || "").toLowerCase();

      if (nomeArquivo.endsWith(".xlsx")) {
        linhasOuCsv = await parseExcel(buffer);
      } else {
        const decodificado = decodificarCsv(buffer);
        if ("erro" in decodificado) {
          return { ok: false, error: { message: decodificado.erro } };
        }
        linhasOuCsv = decodificado.texto;
      }
    } else if (params.origem === "texto") {
      const texto = params.rawText?.trim();
      if (!texto) {
        return { ok: false, error: { message: "Cole os dados ou texto da planilha." } };
      }
      linhasOuCsv = texto;
    } else {
      return { ok: false, error: { message: "Origem inválida." } };
    }

    const tituloSugerido =
      params.customTitle?.trim() ||
      `BASE DE CONHECIMENTO - ESTOQUE ${activeOrg.name.toUpperCase()}`;

    // Conversão padrão universal (alta fidelidade e instantânea)
    const opcoes: UniversalConvertOptions = { titulo: tituloSugerido };
    const resultadoPadrao = converterLinhasEmTextoUniversal(linhasOuCsv, opcoes);

    // Se o usuário solicitou conversão com IA e houver modelo de IA disponível:
    if (params.usarIa && resultadoPadrao.totalLinhas > 0) {
      try {
        const model = resolveLanguageModel(DEFAULT_CLASSIFIER_MODEL) || resolveLanguageModel("anthropic/claude-haiku-4-5");
        if (model) {
          // Pega amostra ou texto completo (limitando a tamanho seguro para LLM)
          const dadosParaPrompt =
            typeof linhasOuCsv === "string"
              ? linhasOuCsv.slice(0, 15000)
              : linhasOuCsv.slice(0, 150).map((r) => r.join("\t")).join("\n");

          const prompt = `Você é o estruturador de dados do Kortex responsável por converter dados de planilhas de estoque, veículos ou produtos para o acervo de conhecimento do agente de IA.

Converta os dados da planilha abaixo exatamente para o formato de documento de texto limpo para o agente de IA consultar.

EXEMPLO DE PADRÃO ESPERADO:
# ${tituloSugerido}

## MOTOS E ELÉTRICOS
SHINERAY SE1: 2022/2022, Cinza, Placa: FPQ-0E35, Preço: R$ 10.900,00, Combustível: Elétrico.
BIZ 125: 2019/2019, Branca, Placa: DMB-2B30, Combustível: Flex.

## IMPORTADOS
BYD DOLPHIN 0km: 2026/2027, Preta, Placa: UJD-4F34, Preço: R$ 149.900,00, Combustível: Elétrico.

## HONDA
CIVIC LXS: 2006/2007, Preta, Placa: DSS-7110, Preço: R$ 48.900,00, Gasolina.

REGRAS OBRIGATÓRIAS:
- Agrupe por marcas, categorias ou seções lógicas com "## NOME DA SEÇÃO" em maiúsculas.
- Cada item deve ocupar apenas UMA linha: NOME DO ITEM: Atributos separados por vírgula.
- Formate preços como "Preço: R$ XX.XXX,XX" se presentes.
- Preserve observações importantes (ex: 0km, Consignado, Sinistro/Leilão, Quilometragem).
- Não invente dados não existentes na planilha.
- Retorne APENAS o texto Markdown formatado, sem introduções, sem explicações e sem cercaduras de código \`\`\`.

DADOS DA PLANILHA:
${dadosParaPrompt}`;

          const { text } = await generateText({
            model,
            prompt,
            temperature: 0.1,
          });

          if (text && text.trim().length > 20) {
            return {
              ok: true,
              data: {
                markdown: text.trim(),
                totalLinhas: resultadoPadrao.totalLinhas,
                tituloSugerido,
                metodo: "ia",
              },
            };
          }
        }
      } catch (errAi) {
        console.warn("[convertSpreadsheetUniversal] Falha no modelo de IA, usando conversor universal:", errAi);
      }
    }

    return {
      ok: true,
      data: {
        markdown: resultadoPadrao.markdown,
        totalLinhas: resultadoPadrao.totalLinhas,
        tituloSugerido,
        metodo: "algoritmo_universal",
      },
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const msg = isTimeout
      ? "Tempo limite esgotado ao ler a planilha (15s)."
      : err instanceof Error
        ? err.message
        : "Erro ao processar e converter a planilha.";
    return { ok: false, error: { message: msg } };
  }
}
