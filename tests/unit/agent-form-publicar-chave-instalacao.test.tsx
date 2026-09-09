import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const acoes = vi.hoisted(() => ({
  salvar: vi.fn(),
  publicar: vi.fn(),
  criar: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/app/ai/agents/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (t: string) => t,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("../_actions", () => ({
  saveAgentDraftAction: acoes.salvar,
  publishAgentAction: acoes.publicar,
  createMcpAgentAction: acoes.criar,
}));

vi.mock("@/app/app/ai/agents/[id]/_actions", () => ({
  saveAgentDraftAction: acoes.salvar,
  publishAgentAction: acoes.publicar,
  createMcpAgentAction: acoes.criar,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("habilita o botão Publicar v1 para OpenRouter com chave de instalação", () => {
    const draftOpenRouter = {
      ...VERSAO_DRAFT,
      version_number: 1,
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      credential_id: null,
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={AGENTE as never}
          credentials={[]}
          provedoresDaInstalacao={["openrouter"]}
          channelSessions={[CANAL] as never}
          draft={draftOpenRouter as never}
          published={null}
          base={draftOpenRouter as never}
        />
      </QueryClientProvider>,
    );

    const botaoPublicar = screen.getByRole("button", { name: /Publicar v1/i });
    expect(botaoPublicar).toBeDefined();
    expect(botaoPublicar.hasAttribute("disabled")).toBe(false);
  });

  it("normaliza ordenação de chaves em trigger_config (jsonb do Postgres) sem marcar form como dirty", () => {
    const draftComPostgresJsonb = {
      ...VERSAO_DRAFT,
      version_number: 1,
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      credential_id: null,
      trigger_config: {
        concurrency: "one_per_conversation",
        events: ["message"],
        filters: {
          business_hours: null,
          ignore_groups: true,
          ignore_self: true,
          keyword_regex: null,
        },
      },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={AGENTE as never}
          credentials={[]}
          provedoresDaInstalacao={["openrouter"]}
          channelSessions={[CANAL] as never}
          draft={draftComPostgresJsonb as never}
          published={null}
          base={draftComPostgresJsonb as never}
        />
      </QueryClientProvider>,
    );

    const botaoPublicar = screen.getByRole("button", { name: /Publicar v1/i });
    expect(botaoPublicar).toBeDefined();
    expect(botaoPublicar.hasAttribute("disabled")).toBe(false);
  });

  it("libera imediatamente o botão Publicar v1 após Salvar rascunho com sucesso sem exigir reload", async () => {
    acoes.salvar.mockResolvedValueOnce({
      ok: true,
      data: {
        version_id: "99999999-9999-4999-8999-999999999999",
        version_number: 1,
      },
    });

    const baseSemDraft = {
      ...VERSAO_DRAFT,
      version_number: 1,
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      credential_id: null,
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={AGENTE as never}
          credentials={[]}
          provedoresDaInstalacao={["openrouter"]}
          channelSessions={[CANAL] as never}
          draft={null}
          published={null}
          base={baseSemDraft as never}
        />
      </QueryClientProvider>,
    );

    // Inicialmente sem draft, o botão está desabilitado
    const botaoPublicarInicial = screen.getByRole("button", { name: /^Publicar$/i });
    expect(botaoPublicarInicial.hasAttribute("disabled")).toBe(true);

    // Altera o nome para tornar o formulário dirty
    const nomeInput = container.querySelector("#name") as HTMLInputElement;
    fireEvent.change(nomeInput, { target: { value: "Atendente IA Modificado" } });

    // Clica em Salvar rascunho
    const botaoSalvar = screen.getByRole("button", { name: /Salvar rascunho/i });
    expect(botaoSalvar.hasAttribute("disabled")).toBe(false);
    fireEvent.click(botaoSalvar);

    await waitFor(() => {
      expect(acoes.salvar).toHaveBeenCalledTimes(1);
    });

    // Logo após salvar o rascunho, o botão é atualizado para Publicar v1 e fica habilitado
    await waitFor(() => {
      const botaoPublicarV1 = screen.getByRole("button", { name: /Publicar v1/i });
      expect(botaoPublicarV1).toBeDefined();
      expect(botaoPublicarV1.hasAttribute("disabled")).toBe(false);
    });
  });
});
