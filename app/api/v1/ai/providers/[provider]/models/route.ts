/**
 * GET /api/v1/ai/providers/:provider/models
 *
 * Lê do catálogo curado `ai_models` (tabela GLOBAL, RLS read-all).
 * Retorna modelos não-deprecated ordenados por default-first depois preço.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";
import { sincronizarCatalogo } from "@/app/api/v1/cron/sync-model-catalog/route";
import type { ModeloDaOpenRouter } from "@/lib/ai/catalogo/openrouter";

export const dynamic = "force-dynamic";

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";

async function buscarDaOpenRouter(): Promise<ModeloDaOpenRouter[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`catalogo_origem_status_${res.status}`);
  const json = (await res.json()) as { data?: ModeloDaOpenRouter[] };
  if (!Array.isArray(json.data)) throw new Error("catalogo_sem_dados");
  return json.data;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { provider } = await ctx.params;

  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data: initialData, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  let data = initialData;

  // Se for OpenRouter e a tabela estiver vazia, tenta conciliar sob demanda
  if (provider === "openrouter" && (!data || data.length === 0)) {
    try {
      const admin = createAdminClient();
      await sincronizarCatalogo(admin, buscarDaOpenRouter);
      const resgate = await supabase
        .from("ai_models")
        .select(MODEL_COLUMNS)
        .eq("provider", provider)
        .is("deprecated_at", null)
        .order("is_default_for_provider", { ascending: false })
        .order("input_price_per_million_cents", { ascending: true });
      if (resgate.data && resgate.data.length > 0) {
        data = resgate.data;
      }
    } catch {
      // Degrada graciosamente se a rede ou a origem oscilar
    }
  }

  return ok({ models: data ?? [] }, { requestId });
}
