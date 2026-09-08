import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { listarCredenciaisDaPlataforma } from "@/lib/ai/credenciais/plataforma";

import { AgentForm } from "../[id]/_components/AgentForm";

export const dynamic = "force-dynamic";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

/**
 * Os provedores cuja chave veio na PLATAFORMA (Admin Master) ou no `.env`.
 */
async function provedoresDaInstalacao(): Promise<string[]> {
  const [a, platCreds] = await Promise.all([
    lerAmbiente(),
    listarCredenciaisDaPlataforma(),
  ]);
  const doEnv = Object.entries(a.chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
  const daPlataforma = platCreds
    .filter((c) => c.is_active)
    .map((c) => c.provider);

  return Array.from(new Set([...doEnv, ...daPlataforma]));
}

export default async function NewAgentPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const [credentialsRes, channelSessions, provedores] = await Promise.all([
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
    provedoresDaInstalacao(),
  ]);

  const credentials = (credentialsRes.data ?? []) as unknown as CredentialRow[];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <AgentForm
        mode="create"
        credentials={credentials}
        provedoresDaInstalacao={provedores}
        channelSessions={channelSessions}
      />
    </div>
  );
}
