import { z } from "zod";

/**
 * Nichos de negócio suportados pela plataforma DeskcommCRM.
 *
 * Cada organização opera estritamente em um nicho ativo por vez.
 * 'ecommerce': Catálogo de produtos, pedidos, integração Nuvemshop e ferramentas comerciais de varejo.
 * 'vehicles': Estoque de automóveis, ficha técnica, quilometragem, preços e ferramentas de concessionária/revenda.
 */
export const BUSINESS_NICHES = ["ecommerce", "vehicles"] as const;

export type BusinessNiche = (typeof BUSINESS_NICHES)[number];

export const businessNicheSchema = z.enum(BUSINESS_NICHES);

export interface BusinessNicheMeta {
  readonly id: BusinessNiche;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly active: boolean;
}

export const BUSINESS_NICHE_MAP: Record<BusinessNiche, BusinessNicheMeta> = {
  ecommerce: {
    id: "ecommerce",
    label: "Comércio Eletrônico",
    description: "Catálogo de produtos, pedidos, integração Nuvemshop e vendas online.",
    icon: "ShoppingCart",
    active: true,
  },
  vehicles: {
    id: "vehicles",
    label: "Veículos & Automotivo",
    description: "Estoque de veículos, modelos, marcas, quilometragem, preços e status comercial.",
    icon: "Car",
    active: true,
  },
};

/**
 * Retorna os nichos homologados e ativos para uso na interface e validações.
 */
export function getActiveBusinessNiches(): BusinessNicheMeta[] {
  return Object.values(BUSINESS_NICHE_MAP).filter((n) => n.active);
}

/**
 * Valida se um valor é um nicho de negócio válido.
 */
export function isBusinessNiche(val: unknown): val is BusinessNiche {
  return typeof val === "string" && (BUSINESS_NICHES as readonly string[]).includes(val);
}

/**
 * Normaliza ou retorna o nicho padrão ('ecommerce') caso o valor seja nulo/inválido.
 */
export function resolveNicheId(nicheId: string | null | undefined): BusinessNiche {
  if (nicheId && isBusinessNiche(nicheId)) {
    return nicheId;
  }
  return "ecommerce";
}

/**
 * Helpers booleanos para verificação direta no runtime e ferramentas.
 */
export function isVehiclesNiche(nicheId: string | null | undefined): boolean {
  return resolveNicheId(nicheId) === "vehicles";
}

export function isEcommerceNiche(nicheId: string | null | undefined): boolean {
  return resolveNicheId(nicheId) === "ecommerce";
}
