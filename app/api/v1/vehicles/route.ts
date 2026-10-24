/**
 * GET /api/v1/vehicles — Lista o estoque de veículos da organização.
 *
 * Consulta a view segura `public.vehicles_safe` (security_invoker = true),
 * garantindo isolamento estrito por organização e nicho 'vehicles', sem
 * expor colunas confidenciais (chassi, placa completa, custos).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "vehicles" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const supabase = await createClient();

  const niche = await resolveOrganizationNiche(supabase, orgId);
  if (niche !== "vehicles") {
    return fail(
      "forbidden_niche",
      "Esta operação é restrita a organizações que operam no nicho 'Veículos'.",
      403,
      { requestId },
    );
  }

  const status = req.nextUrl.searchParams.get("status")?.trim() ?? "";
  const busca = req.nextUrl.searchParams.get("busca")?.trim() ?? "";
  const limite = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limite") ?? "50", 10)));

  let q = supabase
    .from("vehicles_safe")
    .select("*")
    .eq("organization_id", orgId);

  if (status !== "") {
    q = q.eq("status", status);
  }

  if (busca !== "") {
    q = q.or(`marca.ilike.%${busca}%,modelo.ilike.%${busca}%,versao.ilike.%${busca}%`);
  }

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) {
    return fail("internal_error", "Erro ao listar o estoque de veículos.", 500, { requestId });
  }

  return ok({ veiculos: data ?? [] }, { requestId });
}
