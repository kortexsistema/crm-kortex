"use client";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { AgentStatusBadge, deriveAgentStatus } from "./AgentStatusBadge";
import { AgentRowMenu } from "./AgentRowMenu";

interface Props {
  agent: AgentRow;
  canWrite: boolean;
}

/**
 * A linha do modelo, dizendo o que está EM VIGOR.
 *
 * Três casos, e cada um existe por um motivo medido:
 *
 *  1. versão publicada → é ela que o runtime lê (`agent-config.ts`), então é ela
 *     que a lista mostra. `ai_agents.model` não é sincronizado ao publicar.
 *  2. `provedor/modelo` → o formato do `rag_bot` legado, onde a coluna É a fonte.
 *  3. id nu → como todo `mcp_agent` nasce (`createMcpAgentAction` grava o id do
 *     catálogo). Antes, o `split("/")[0]` devolvia o próprio modelo e a lista
 *     renderizava "claude-sonnet-4-6 · claude-sonnet-4-6".
 */
/**
 * De ONDE saiu a linha acima — para a tela poder dizer isso a quem olha.
 *
 * Enxertado do PR #267 (@Lucas-BritoDev), que trazia a mesma informação num
 * módulo próprio. A regra ficou a desta função (é a que está em vigor e trata o
 * id nu do `mcp_agent` recém-criado); o que veio de lá é a EXPLICAÇÃO, que aqui
 * não existia: "anthropic · claude-sonnet-5" sozinho não diz se é o que atende
 * o cliente ou o que ficou no rascunho — e essa é exatamente a confusão que
 * custou uma depuração no modelo errado.
 */
export function origemDoModelo(agent: AgentRow): "versao_publicada" | "cadastro" {
  return agent.versao_publicada?.model ? "versao_publicada" : "cadastro";
}

export function modeloEmVigor(agent: AgentRow): string {
  const publicada = agent.versao_publicada;
  if (publicada?.model) {
    return publicada.provider ? `${publicada.provider} · ${publicada.model}` : publicada.model;
  }
  const cadastro = agent.model?.trim() ?? "";
  if (cadastro === "") return "—";
  if (!cadastro.includes("/")) return cadastro;
  const [provedor, ...resto] = cadastro.split("/");
  return `${provedor} · ${resto.join("/")}`;
}

export function modeloDoRascunho(
  draft?: { provider?: string | null; model?: string | null } | null,
): string | null {
  if (!draft?.model) return null;
  return draft.provider ? `${draft.provider} · ${draft.model}` : draft.model;
}

export function AgentCard({ agent, canWrite }: Props) {
  const t = useT();
  const status = deriveAgentStatus(agent);

  const versoesResolvidas = escolherVersoesDaTela(
    agent.versoes ?? [],
    agent.published_version_id ?? null,
  );
  const publishedVersion = versoesResolvidas.published;
  const draftVersion = versoesResolvidas.draft;

  // Se o agente tem versão publicada em vigor E um rascunho vigente mais novo
  const temPublicadaERascunho =
    status === "published" &&
    draftVersion !== null &&
    (publishedVersion !== null || Boolean(agent.published_version_id));

  const pubVersionNumber =
    publishedVersion?.version_number ?? agent.versao_publicada?.version_number;
  const modeloRascunho = modeloDoRascunho(draftVersion);

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="truncate font-medium" title={agent.name}>
            {agent.name}
          </h3>
          <p
            className="truncate text-xs text-muted-foreground"
            title={
              origemDoModelo(agent) === "versao_publicada"
                ? t("Modelo da versão publicada — é o que atende o cliente.")
                : t("Modelo do cadastro; nenhuma versão publicada ainda.")
            }
          >
            {origemDoModelo(agent) === "versao_publicada" && (
              <span className="font-medium text-foreground">{t("No ar:")} </span>
            )}
            {modeloEmVigor(agent)}
          </p>
          {draftVersion && modeloRascunho && (
            <p
              className="truncate text-xs font-medium text-amber-600 dark:text-amber-400"
              title={t("Rascunho salvo com alterações pendentes de publicação.")}
            >
              <span className="opacity-90">{t("Rascunho")} v{draftVersion.version_number}:</span>{" "}
              {modeloRascunho} {t("(não publicado)")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {agent.is_default && (
            <Badge variant="secondary" className="text-xs">
              {t("default")}
            </Badge>
          )}
          {temPublicadaERascunho ? (
            <div className="flex items-center gap-1">
              <Badge variant="default" className="text-xs">
                {t("Publicado")} {pubVersionNumber ? `v${pubVersionNumber}` : ""}
              </Badge>
              <Badge
                variant="secondary"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium"
              >
                {t("Rascunho")} v{draftVersion.version_number}
              </Badge>
            </div>
          ) : (
            <AgentStatusBadge status={status} />
          )}
          {canWrite && <AgentRowMenu agent={agent} />}
        </div>
      </div>
      {agent.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 pt-1 text-xs">
        <div>
          <dt className="text-muted-foreground">{t("Tipo")}</dt>
          <dd className="font-mono">{agent.kind ?? "rag_bot"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Prioridade")}</dt>
          <dd className="font-mono">{agent.priority ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-auto pt-2">
        <Link href={`/app/ai/agents/${agent.id}`}>
          <Button variant="outline" size="sm" className="w-full">
            {canWrite
              ? temPublicadaERascunho
                ? t("Revisar rascunho")
                : t("Editar")
              : t("Visualizar")}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
