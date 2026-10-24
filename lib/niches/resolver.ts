import type { SupabaseClient } from "@supabase/supabase-js";
import { isBusinessNiche, type BusinessNiche } from "./types";

/**
 * Resolve o nicho de negócio ativo de uma organização de forma estrita.
 *
 * ⚠️ REGRA DE FAIL-CLOSED:
 * Em caso de erro, organização não encontrada ou nicho não configurado/inválido,
 * devolve `null` (NUNCA assume 'ecommerce' como fallback para autorização de ferramentas).
 *
 * Ferramentas universais (CRM core) funcionam independentemente do nicho.
 * Ferramentas especializadas (e-commerce, veículos) exigem que o nicho retornado
 * corresponda exatamente ao nicho requerido.
 */
export async function resolveOrganizationNiche(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<BusinessNiche | null> {
  if (!organizationId) return null;

  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("niche_id")
      .eq("id", organizationId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const niche = (data as { niche_id?: string | null }).niche_id;
    if (isBusinessNiche(niche)) {
      return niche;
    }

    return null;
  } catch {
    return null;
  }
}
