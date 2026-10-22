import { describe, expect, it, vi } from "vitest";
import { validarEscopoDaVersao, mensagemDoEscopo } from "@/lib/ai/agents/escopo";

describe("validarEscopoDaVersao — tratamento defensivo de escopo de agente", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const ID_ATIVO_1 = "22222222-2222-4222-8222-222222222222";
  const ID_ATIVO_2 = "33333333-3333-4333-8333-333333333333";
  const ID_ARQUIVADO = "44444444-4444-4444-8444-444444444444";
  const ID_INEXISTENTE = "55555555-5555-4555-8555-555555555555";

  const FUNIL_ATIVO = "66666666-6666-4666-8666-666666666666";
  const FUNIL_ARQUIVADO = "77777777-7777-4777-8777-777777777777";

  function criarMockSupabase(opcoes: {
    materiaisAtivos?: string[];
    funisAtivos?: string[];
  }) {
    const materiaisValidos = new Set(opcoes.materiaisAtivos ?? []);
    const funisValidos = new Set(opcoes.funisAtivos ?? []);

    return {
      from: vi.fn((tabela: string) => {
        if (tabela === "ai_knowledge_sources") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async (_col: string, ids: string[]) => {
              const data = ids
                .filter((id) => materiaisValidos.has(id))
                .map((id) => ({ id }));
              return { data, error: null };
            }),
          };
        }

        if (tabela === "crm_pipelines") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async (_col: string, ids: string[]) => {
              const data = ids
                .filter((id) => funisValidos.has(id))
                .map((id) => ({ id }));
              return { data, error: null };
            }),
          };
        }

        throw new Error(`Tabela inesperada: ${tabela}`);
      }),
    };
  }

  it("remove automaticamente materiais arquivados ou inexistentes sem travar o salvamento", async () => {
    const supabase = criarMockSupabase({
      materiaisAtivos: [ID_ATIVO_1, ID_ATIVO_2],
    });

    const resultado = await validarEscopoDaVersao(
      supabase as never,
      ORG,
      {
        knowledge_source_ids: [ID_ATIVO_1, ID_ARQUIVADO, ID_ATIVO_2, ID_INEXISTENTE],
      },
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("esperava ok: true");
    expect(resultado.escopoSanitizado.knowledge_source_ids).toEqual([ID_ATIVO_1, ID_ATIVO_2]);
    expect(resultado.removidos.knowledge_source_ids).toEqual([ID_ARQUIVADO, ID_INEXISTENTE]);
  });

  it("remove automaticamente funis arquivados ou inexistentes sem travar o salvamento", async () => {
    const supabase = criarMockSupabase({
      funisAtivos: [FUNIL_ATIVO],
    });

    const resultado = await validarEscopoDaVersao(
      supabase as never,
      ORG,
      {
        pipeline_ids: [FUNIL_ATIVO, FUNIL_ARQUIVADO],
      },
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("esperava ok: true");
    expect(resultado.escopoSanitizado.pipeline_ids).toEqual([FUNIL_ATIVO]);
    expect(resultado.removidos.pipeline_ids).toEqual([FUNIL_ARQUIVADO]);
  });

  it("mantém todos os IDs quando todos forem válidos e ativos", async () => {
    const supabase = criarMockSupabase({
      materiaisAtivos: [ID_ATIVO_1, ID_ATIVO_2],
      funisAtivos: [FUNIL_ATIVO],
    });

    const resultado = await validarEscopoDaVersao(
      supabase as never,
      ORG,
      {
        knowledge_source_ids: [ID_ATIVO_1, ID_ATIVO_2],
        pipeline_ids: [FUNIL_ATIVO],
      },
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("esperava ok: true");
    expect(resultado.escopoSanitizado.knowledge_source_ids).toEqual([ID_ATIVO_1, ID_ATIVO_2]);
    expect(resultado.escopoSanitizado.pipeline_ids).toEqual([FUNIL_ATIVO]);
    expect(resultado.removidos.knowledge_source_ids).toEqual([]);
    expect(resultado.removidos.pipeline_ids).toEqual([]);
  });

  it("resulta em array vazio quando todos os materiais estiverem arquivados", async () => {
    const supabase = criarMockSupabase({
      materiaisAtivos: [],
    });

    const resultado = await validarEscopoDaVersao(
      supabase as never,
      ORG,
      {
        knowledge_source_ids: [ID_ARQUIVADO, ID_INEXISTENTE],
      },
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("esperava ok: true");
    expect(resultado.escopoSanitizado.knowledge_source_ids).toEqual([]);
    expect(resultado.removidos.knowledge_source_ids).toEqual([ID_ARQUIVADO, ID_INEXISTENTE]);
  });

  it("mensagemDoEscopo formata a mensagem com o total de itens removidos se necessário", () => {
    const msg = mensagemDoEscopo({
      campo: "knowledge_source_ids",
      ausentes: [ID_ARQUIVADO, ID_INEXISTENTE],
    });
    expect(msg).toContain("2");
    expect(msg).toContain("foi arquivado");
  });
});
