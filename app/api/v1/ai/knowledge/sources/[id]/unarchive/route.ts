import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

async function resolveContext(requestId: string) {
  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return { error: authz.response };
  return { authUser: authz.user, activeOrg: authz.org };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  // Verify ownership with user-scoped client.
  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, status")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[ai-knowledge-sources] unarchive fetch failed:", fetchErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }
  if (existing.status !== "archived") {
    return fail("conflict", "Material não está arquivado.", 409, { requestId });
  }

  const admin = createAdminClient();
  const { error: unarchiveErr } = await admin
    .from("ai_knowledge_sources")
    .update({ status: "ready", is_active: true })
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId);

  if (unarchiveErr) {
    console.error("[ai-knowledge-sources] desarquivar falhou:", unarchiveErr.message);
    return fail("internal_error", "Erro ao desarquivar o material.", 500, { requestId });
  }

  return ok({ id: sourceId, status: "ready" }, { requestId });
}
