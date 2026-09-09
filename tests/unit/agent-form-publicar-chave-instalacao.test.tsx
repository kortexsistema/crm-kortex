import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (t: string) => t,
}));

vi.mock("../_actions", () => ({
  saveAgentDraftAction: vi.fn(),
  publishAgentAction: vi.fn(),
  createMcpAgentAction: vi.fn(),
}));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

const AGENTE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Atendente IA",
  description: "Assistente virtual",
  priority: 0,
};

const CANAL = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "WhatsApp Comercial",
  phone_number: "+5511999999999",
  status: "working",
};

const VERSAO_DRAFT = {
  id: "33333333-3333-4333-8333-333333333333",
  agent_id: AGENTE.id,
  version_number: 2,
  provider: "anthropic",
  model: "claude-sonnet-5",
  credential_id: null, // chave da instalação
  channel_session_id: CANAL.id,
  system_prompt: "Instruções completas do assistente para atendimento ao cliente.",
  tool_ids: [],
  max_steps: 10,
  token_budget: 50000,
  cost_budget_cents: 50,
  history_message_window: 20,
  history_token_window: 8000,
  handoff_keywords: [],
  handoff_tool_enabled: true,
  cases_enabled: false,
  split_messages: false,
  split_max_chars: 600,
  followup: { enabled: false, flow_pointer_ids: [] },
  operator_enabled: false,
  operator_model: null,
  operator_tool_ids: [],
  pipeline_ids: [],
  knowledge_source_ids: [],
  trigger_config: null,
  status: "draft",
  published_at: null,
  superseded_at: null,
  created_at: "2026-09-08T00:00:00Z",
  created_by: null,
};

describe("AgentForm — Publicação com Chave Padrão da Plataforma / Instalação", () => {
  it("habilita o botão Publicar quando a instalação possui chave do provedor", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={AGENTE as never}
          credentials={[]} // Sem BYOK próprio do tenant
          provedoresDaInstalacao={["anthropic"]} // Chave disponível na plataforma/instalação
          channelSessions={[CANAL] as never}
          draft={VERSAO_DRAFT as never}
          published={null}
          base={VERSAO_DRAFT as never}
        />
      </QueryClientProvider>,
    );

    const botaoPublicar = screen.getByRole("button", { name: /Publicar v2/i });
    expect(botaoPublicar).toBeDefined();
    // O botão NÃO pode estar desabilitado
    expect(botaoPublicar.hasAttribute("disabled")).toBe(false);
  });

  it("bloqueia o botão Publicar se a instalação não possuir chave do provedor", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={AGENTE as never}
          credentials={[]}
          provedoresDaInstalacao={[]} // Nenhuma chave configurada
          channelSessions={[CANAL] as never}
          draft={VERSAO_DRAFT as never}
          published={null}
          base={VERSAO_DRAFT as never}
        />
      </QueryClientProvider>,
    );

    const botaoPublicar = screen.getByRole("button", { name: /Publicar v2/i });
    expect(botaoPublicar).toBeDefined();
    expect(botaoPublicar.hasAttribute("disabled")).toBe(true);
  });
});
