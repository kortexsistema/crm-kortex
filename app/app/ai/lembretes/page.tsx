import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { LembretesForm } from "./_form";

export const metadata = { title: "Lembretes Automáticos" };
export const dynamic = "force-dynamic";

export default async function LembretesDaOrganizacaoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  
  const idioma = user.idioma;

  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  // Extract current configuration or default
  const settings = data?.settings as Record<string, unknown> | null;
  const remindersConfig = (settings?.appointment_reminders as any) || {
    enabled: true,
    hours_before: 24,
    custom_prompt: ""
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Lembretes Automáticos", idioma)}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir("Configure quando e como a IA deve enviar mensagens avisando os clientes de compromissos agendados.", idioma)}
        </p>
      </header>

      <LembretesForm config={remindersConfig} />
    </div>
  );
}
