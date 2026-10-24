/**
 * Capacidades de VEÍCULOS — Ferramentas MCP para consulta estruturada do estoque automotivo.
 *
 * Exclusivas para organizações com nicho de negócio 'vehicles' (concessionárias e revendas).
 * Não expõem dados confidenciais (placa completa, chassi, custos internos, observações internas).
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente, e a
 * fonte é sempre `ctx.organizationId` (token/sessão autenticada), NUNCA o input.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";
import { formatCents } from "@/lib/money";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import {
  type VehicleSafeRow,
  VEHICLE_CAMBIOS,
  VEHICLE_COMBUSTIVEIS,
  VEHICLE_STATUSES,
} from "@/lib/vehicles/types";

// ---------------------------------------------------------------------------
// 1. Pesquisa estruturada de veículos (crm_search_vehicles)
// ---------------------------------------------------------------------------

const searchVehiclesInputShape = {
  marca: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filtro por marca do veículo (ex: Volkswagen, Chevrolet, Fiat, Toyota, Honda)."),
  modelo: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filtro por modelo do veículo (ex: Gol, Onix, Corolla, Civic, Strada)."),
  versao: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filtro por versão específica (ex: 1.0 MPI, Comfortline, XEi)."),
  ano_min: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe("Ano mínimo do modelo ou fabricação."),
  ano_max: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe("Ano máximo do modelo ou fabricação."),
  combustivel: z
    .enum(VEHICLE_COMBUSTIVEIS)
    .optional()
    .describe("Tipo de combustível (flex, gasolina, diesel, etanol, eletrico, hibrido, gnv, outro)."),
  cambio: z
    .enum(VEHICLE_CAMBIOS)
    .optional()
    .describe("Tipo de câmbio / transmissão (manual, automatico, automatizado, cvt, outro)."),
  cor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Cor do veículo (ex: Preto, Branco, Prata, Vermelho)."),
  preco_min_cents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Preço mínimo em centavos da moeda (ex: 5000000 para R$ 50.000,00)."),
  preco_max_cents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Preço máximo em centavos da moeda (ex: 10000000 para R$ 100.000,00)."),
  km_min: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Quilometragem mínima rodada."),
  km_max: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Quilometragem máxima rodada."),
  status: z
    .enum(VEHICLE_STATUSES)
    .optional()
    .default("disponivel")
    .describe(
      "Status comercial do veículo. Padrão: 'disponivel'. Outras opções: 'reservado', 'vendido', 'em_preparacao'."
    ),
  pagina: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("Número da página de resultados (iniciando em 1). Padrão: 1."),
  limite: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe("Quantidade de veículos por página (1 a 50). Padrão: 10."),
  ordenacao: z
    .enum(["recentes", "preco_asc", "preco_desc", "ano_desc", "km_asc"])
    .optional()
    .default("recentes")
    .describe("Critério de ordenação determinística. Padrão: 'recentes'."),
};

export const crmSearchVehicles: McpToolDefinition<typeof searchVehiclesInputShape> = {
  name: "crm_search_vehicles",
  description:
    "Pesquisa veículos no estoque da organização por filtros comerciais estruturados " +
    "(marca, modelo, versão, ano, combustível, câmbio, cor, faixa de preço, faixa de " +
    "quilometragem e status comercial). Retorna contagem total precisa, lista paginada e " +
    "indicação de mais resultados para permitir navegação completa. Por padrão busca apenas 'disponivel'.",
  inputSchema: searchVehiclesInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  requiresNiche: "vehicles",
  handler: async (input, ctx) => {
    // Camada 3 de defesa: validação defensiva do nicho no handler
    const niche = ctx.nicheId ?? (await resolveOrganizationNiche(ctx.supabase, ctx.organizationId));
    if (niche !== "vehicles") {
      throw new Error(
        `nicho_incompativel: esta ferramenta requer o nicho 'vehicles' (nicho atual: '${niche ?? "indefinido"}')`,
      );
    }

    const pagina = input.pagina ?? 1;
    const limite = input.limite ?? 10;
    const offset = (pagina - 1) * limite;

    let query = ctx.supabase
      .from("vehicles_safe")
      .select("*", { count: "exact" })
      .eq("organization_id", ctx.organizationId);

    // Filtros de texto estruturado
    if (input.marca) {
      query = query.ilike("marca", `%${input.marca}%`);
    }
    if (input.modelo) {
      query = query.ilike("modelo", `%${input.modelo}%`);
    }
    if (input.versao) {
      query = query.ilike("versao", `%${input.versao}%`);
    }
    if (input.cor) {
      query = query.ilike("cor", `%${input.cor}%`);
    }

    // Filtros enum / exatos
    if (input.combustivel) {
      query = query.eq("combustivel", input.combustivel);
    }
    if (input.cambio) {
      query = query.eq("cambio", input.cambio);
    }
    // Status comercial padrão: 'disponivel'
    const status = input.status ?? "disponivel";
    query = query.eq("status", status);

    // Filtros de faixa de ano (ano_modelo)
    if (input.ano_min !== undefined) {
      query = query.gte("ano_modelo", input.ano_min);
    }
    if (input.ano_max !== undefined) {
      query = query.lte("ano_modelo", input.ano_max);
    }

    // Filtros de faixa de preço em centavos
    if (input.preco_min_cents !== undefined) {
      query = query.gte("preco_cents", input.preco_min_cents);
    }
    if (input.preco_max_cents !== undefined) {
      query = query.lte("preco_cents", input.preco_max_cents);
    }

    // Filtros de faixa de quilometragem
    if (input.km_min !== undefined) {
      query = query.gte("quilometragem", input.km_min);
    }
    if (input.km_max !== undefined) {
      query = query.lte("quilometragem", input.km_max);
    }

    // Ordenação determinística com desempate por id
    const ordenacao = input.ordenacao ?? "recentes";
    switch (ordenacao) {
      case "preco_asc":
        query = query
          .order("preco_cents", { ascending: true, nullsFirst: false })
          .order("id", { ascending: true });
        break;
      case "preco_desc":
        query = query
          .order("preco_cents", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true });
        break;
      case "ano_desc":
        query = query
          .order("ano_modelo", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true });
        break;
      case "km_asc":
        query = query
          .order("quilometragem", { ascending: true, nullsFirst: false })
          .order("id", { ascending: true });
        break;
      case "recentes":
      default:
        query = query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true });
        break;
    }

    // Paginação
    query = query.range(offset, offset + limite - 1);

    const { data, count, error } = (await query) as {
      data: VehicleSafeRow[] | null;
      count: number | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new Error(`buscar_veiculos_falhou: ${error.message}`);
    }

    const total = count ?? 0;
    const veiculosRetornados = data ?? [];
    const temMais = total > offset + veiculosRetornados.length;
    const totalPaginas = Math.ceil(total / limite);

    return {
      total,
      pagina,
      limite,
      total_paginas: totalPaginas,
      tem_mais: temMais,
      filtros_aplicados: {
        marca: input.marca ?? null,
        modelo: input.modelo ?? null,
        versao: input.versao ?? null,
        ano_min: input.ano_min ?? null,
        ano_max: input.ano_max ?? null,
        combustivel: input.combustivel ?? null,
        cambio: input.cambio ?? null,
        cor: input.cor ?? null,
        preco_min_cents: input.preco_min_cents ?? null,
        preco_max_cents: input.preco_max_cents ?? null,
        km_min: input.km_min ?? null,
        km_max: input.km_max ?? null,
        status: input.status,
        ordenacao,
      },
      veiculos: veiculosRetornados.map((v) => ({
        id: v.id,
        marca: v.marca,
        modelo: v.modelo,
        versao: v.versao,
        ano_fabricacao: v.ano_fabricacao,
        ano_modelo: v.ano_modelo,
        cor: v.cor,
        combustivel: v.combustivel,
        cambio: v.cambio,
        quilometragem: v.quilometragem, // null preservado, nunca zero
        preco_cents: v.preco_cents, // null preservado, nunca zero
        preco_formatado: v.preco_cents !== null ? formatCents(v.preco_cents, v.moeda) : null,
        moeda: v.moeda,
        status: v.status,
        opcionais: v.opcionais ?? [],
        fotos_urls: v.fotos_urls ?? [],
        placa_final: v.placa_final,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Detalhes comerciais de um veículo específico (crm_get_vehicle)
// ---------------------------------------------------------------------------

const getVehicleInputShape = {
  vehicle_id: z.string().uuid().describe("O identificador único (ID) do veículo no estoque."),
};

export const crmGetVehicle: McpToolDefinition<typeof getVehicleInputShape> = {
  name: "crm_get_vehicle",
  description:
    "Obtém os detalhes comerciais completos e seguros de um veículo específico do estoque pelo seu ID. " +
    "Retorna marca, modelo, versão, ano, combustível, câmbio, quilometragem, preço, opcionais e fotos. " +
    "Não expõe dados confidenciais.",
  inputSchema: getVehicleInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  requiresNiche: "vehicles",
  handler: async (input, ctx) => {
    // Camada 3 de defesa: validação defensiva do nicho no handler
    const niche = ctx.nicheId ?? (await resolveOrganizationNiche(ctx.supabase, ctx.organizationId));
    if (niche !== "vehicles") {
      throw new Error(
        `nicho_incompativel: esta ferramenta requer o nicho 'vehicles' (nicho atual: '${niche ?? "indefinido"}')`,
      );
    }

    const { data, error } = (await ctx.supabase
      .from("vehicles_safe")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.vehicle_id)
      .maybeSingle()) as {
      data: VehicleSafeRow | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new Error(`obter_veiculo_falhou: ${error.message}`);
    }

    // Se não encontrou ou pertence a outro tenant, retorna não encontrado de forma segura
    if (!data) {
      return {
        encontrado: false,
        veiculo: null,
        mensagem: "Veículo não encontrado no estoque da organização.",
      };
    }

    return {
      encontrado: true,
      veiculo: {
        id: data.id,
        marca: data.marca,
        modelo: data.modelo,
        versao: data.versao,
        ano_fabricacao: data.ano_fabricacao,
        ano_modelo: data.ano_modelo,
        cor: data.cor,
        combustivel: data.combustivel,
        cambio: data.cambio,
        quilometragem: data.quilometragem, // null preservado, nunca zero
        preco_cents: data.preco_cents, // null preservado, nunca zero
        preco_formatado: data.preco_cents !== null ? formatCents(data.preco_cents, data.moeda) : null,
        moeda: data.moeda,
        status: data.status,
        opcionais: data.opcionais ?? [],
        fotos_urls: data.fotos_urls ?? [],
        placa_final: data.placa_final,
        atualizado_em: data.updated_at,
      },
    };
  },
};
