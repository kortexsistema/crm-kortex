import { NavHub } from "@/components/shell/NavHub";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/**
 * Hub de Atendimento.
 *
 * Reúne o que se abre todo dia (Inbox, Casos, Radar, Agenda) e o que se
 * usa para preparar o atendimento (Respostas rápidas). Criado para respeitar
 * a regra de densidade da navegação lateral.
 */
export default async function AtendimentoHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const idioma = user.idioma;

  return (
    <NavHub
      group="atendimento"
      isPlatformAdmin={user.is_platform_admin && !user.support}
      role={activeOrg?.role ?? null}
      interfaceSettings={activeOrg?.interface_settings}
      title={traduzir("Atendimento", idioma)}
      subtitle={traduzir(
        "As conversas diárias e as ferramentas que o preparam para atender.",
        idioma,
      )}
      locale={idioma}
    />
  );
}
