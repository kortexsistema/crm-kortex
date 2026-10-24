import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { resolveOrganizationNiche } from "@/lib/niches/resolver";
import { createClient } from "@/lib/supabase/server";
import type { SafeVehiclePreview } from "@/lib/vehicles/sanitizer";
import { VehiclesClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  // Verifica o nicho ativo da organização
  const niche = await resolveOrganizationNiche(supabase, activeOrg.orgId);
  if (niche !== "vehicles") {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="p-4 bg-muted/40 rounded-full inline-block">
          <span className="text-3xl">🚗</span>
        </div>
        <h1 className="text-xl font-bold text-foreground">Módulo de Veículos Indisponível</h1>
        <p className="text-sm text-muted-foreground">
          Sua organização está configurada para operar no nicho <strong>{niche ?? "indefinido"}</strong>.
          O estoque automotivo é exclusivo para organizações com o nicho <strong>Veículos</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          Para solicitar a alteração de nicho de negócio, entre em contato com o Administrador da Plataforma.
        </p>
      </div>
    );
  }

  const podeEditar =
    (user.is_platform_admin && !user.support) ||
    ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const { data } = await supabase
    .from("vehicles_safe")
    .select("*")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <VehiclesClient
      inicial={(data ?? []) as unknown as SafeVehiclePreview[]}
      podeEditar={podeEditar}
      nicheId={niche}
    />
  );
}
