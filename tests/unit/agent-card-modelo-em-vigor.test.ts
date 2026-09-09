/**
 * O CARTÃO DO AGENTE TEM DE MOSTRAR O MODELO QUE ESTÁ EM VIGOR.
 *
 * ─── O defeito, medido num banco de produção ────────────────────────────────
 *
 * O cartão montava a linha do modelo assim:
 *
 *     const provider = agent.model?.split("/")[0] ?? "?";
 *     …
 *     {provider} · {formatModel(agent.model)}
 *
 * O formato `provedor/modelo` só vale para o `rag_bot` legado. Todo `mcp_agent`
 * nasce com o id NU em `ai_agents.model` — `createMcpAgentAction` grava
 * `parsed.data.version.model`, que é o id como o catálogo o registra. Sem a
 * barra, `split("/")[0]` devolve o próprio modelo, e a lista renderiza:
 *
 *     claude-sonnet-4-6 · claude-sonnet-4-6
 *
 * Medido: dos 6 agentes de uma organização real, os 5 `mcp_agent` tinham o valor
 * nu e só o `rag_bot` tinha o prefixado. É errado no dia 1, em toda instalação.
 *
 * ─── E tem o defeito de baixo, que é o pior ─────────────────────────────────
 *
 * Para `mcp_agent`, `ai_agents.model` é coluna MORTA: o runtime lê
 * `ai_agent_versions.model` da versão publicada, e `fn_publish_ai_agent_version`
 * nunca sincroniza a de cima. Trocar o modelo na tela e publicar deixava o
 * cartão anunciando o modelo do cadastro para sempre. Mostrar o valor da versão
 * publicada é o que faz a lista falar do que está no ar — e é a mesma decisão
 * que `deriveAgentStatus` já tomou para o status: não sincronizar a coluna
 * morta, parar de lê-la.
 */
import { describe, expect, it } from "vitest";

import { modeloDoRascunho, modeloEmVigor } from "@/app/app/ai/agents/_components/AgentCard";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import type { AgentRow } from "@/hooks/ai/useAgent";

function agente(over: Partial<AgentRow>): AgentRow {
  return {
    id: "a1",
    organization_id: "org-1",
    name: "Agente",
    description: null,
    model: "claude-sonnet-4-6",
    system_prompt: "instruções",
    is_active: true,
    is_default: false,
    config: {},
    guardrails: [],
    active_kb_version_id: null,
    kind: "mcp_agent",
    published_version_id: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as AgentRow;
}

describe("modelo mostrado no cartão do agente", () => {
  it("não repete o modelo no lugar do provedor", () => {
    // O defeito literal: sem barra, o `split` devolvia o próprio modelo.
    expect(modeloEmVigor(agente({ model: "claude-sonnet-4-6" }))).toBe("claude-sonnet-4-6");
  });

  it("mostra o modelo da versão PUBLICADA, não o do cadastro", () => {
    // `ai_agents.model` é o valor do cadastro e nunca é atualizado ao publicar.
    // Quem responde no WhatsApp é o da versão.
    const a = agente({
      model: "claude-sonnet-4-6",
      published_version_id: "v7",
      versao_publicada: { provider: "anthropic", model: "claude-sonnet-5" },
    });
    expect(modeloEmVigor(a)).toBe("anthropic · claude-sonnet-5");
  });

  it("mantém provedor · modelo para o rag_bot legado, onde a coluna é a fonte", () => {
    const a = agente({ kind: "rag_bot", model: "anthropic/claude-sonnet-4-6" });
    expect(modeloEmVigor(a)).toBe("anthropic · claude-sonnet-4-6");
  });

  it("agente sem modelo nenhum não inventa um", () => {
    expect(modeloEmVigor(agente({ model: "" }))).toBe("—");
  });

  it("extrai e formata o modelo do rascunho corretamente", () => {
    expect(modeloDoRascunho({ provider: "openrouter", model: "openai/gpt-4o" })).toBe(
      "openrouter · openai/gpt-4o",
    );
    expect(modeloDoRascunho({ provider: null, model: "claude-sonnet-4-6" })).toBe(
      "claude-sonnet-4-6",
    );
    expect(modeloDoRascunho(null)).toBeNull();
    expect(modeloDoRascunho({ model: null })).toBeNull();
  });

  it("distingue a versão publicada ativa do rascunho salvo (ex: Anthropic publicada vs OpenRouter rascunho)", () => {
    const versoes = [
      {
        id: "v2-id",
        version_number: 2,
        status: "draft",
        provider: "openrouter",
        model: "openai/gpt-4o",
      },
      {
        id: "v1-id",
        version_number: 1,
        status: "published",
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
      },
    ];

    const a = agente({
      published_version_id: "v1-id",
      versao_publicada: {
        version_number: 1,
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
      },
      versoes,
    });

    const { published, draft } = escolherVersoesDaTela(a.versoes!, a.published_version_id);

    // O modelo no ar continua sendo a v1 (Anthropic)
    expect(modeloEmVigor(a)).toBe("anthropic · claude-3-5-sonnet-20241022");
    expect(published?.version_number).toBe(1);

    // O rascunho pendente é a v2 (OpenRouter)
    expect(draft?.version_number).toBe(2);
    expect(modeloDoRascunho(draft)).toBe("openrouter · openai/gpt-4o");
  });
});
