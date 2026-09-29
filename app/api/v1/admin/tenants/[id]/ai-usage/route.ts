import { type NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAggregatedUsage } from "@/lib/ai/usage/query";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;

const querySchema = z.object({
  agent_id: z.string().uuid().optional(),
  invocation_kind: z.string().min(1).max(64).optional(),
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
});

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function parseDayUtc(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function resolveRange(qs: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const to = qs.to ? parseDayUtc(qs.to) : startOfUtcDay(now);
  let from = qs.from ? parseDayUtc(qs.from) : startOfUtcDay(new Date(now.getTime() - 29 * 86_400_000));

  const diffDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (diffDays > MAX_RANGE_DAYS - 1) {
    from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * 86_400_000);
  }
  if (from.getTime() > to.getTime()) {
    from = to;
  }
  return { from: startOfUtcDay(from), to: startOfUtcDay(to) };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const requestId = randomUUID();
  const { id: tenantId } = await params;

  const authz = await requirePlatformAdmin();
  const idioma = normalizarIdioma((authz.user.user_metadata?.locale as string | undefined) ?? null);
  const t = (texto: string) => traduzir(texto, idioma);

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return fail("validation_failed", t("Filtros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const range = resolveRange(parsed.data);
  const supabase = createAdminClient();

  try {
    const payload = await fetchAggregatedUsage(supabase, tenantId, range, {
      agent_id: parsed.data.agent_id,
      invocation_kind: parsed.data.invocation_kind,
    });
    return ok(payload, { requestId });
  } catch (err) {
    return fail("internal_error", "Erro ao agregar o uso de IA.", 500, { requestId });
  }
}
