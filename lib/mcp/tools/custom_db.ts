import { z } from "zod";
import type { McpToolDefinition } from "../types";
import { createAdminClient } from "@/lib/supabase/admin";

const inputShape = {
  table: z.string().describe("Nome da tabela a ser consultada"),
  select: z.string().optional().describe("Colunas a serem selecionadas (formato PostgREST)"),
  limit: z.number().optional().describe("Limite de linhas a retornar"),
};

export const queryExternalSupabaseTool: McpToolDefinition<typeof inputShape> = {
  name: "query_external_supabase",
  description: "Consulta tabelas no banco de dados externo do cliente (Supabase de terceiros). Útil para ler estoque, pedidos customizados, ordens de serviço, etc.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const admin = createAdminClient();
    
    const { data: integration, error: intErr } = await admin
      .from("tenant_integrations")
      .select("oauth_access_token_encrypted, store_metadata")
      .eq("organization_id", ctx.organizationId)
      .eq("provider", "external_supabase")
      .single();
      
    if (intErr || !integration) {
      return { error: "Integração external_supabase não configurada para este tenant." };
    }
    
    const { data: decrypted, error: decErr } = await admin.rpc("fn_decrypt_oauth", {
      ciphertext: integration.oauth_access_token_encrypted,
    });
    
    if (decErr || !decrypted) {
      return { error: "Falha ao descriptografar a chave de API externa." };
    }
    
    const url = (integration.store_metadata as any)?.supabase_url;
    if (!url) {
      return { error: "URL do Supabase ausente na configuração." };
    }
    
    try {
      const fetchUrl = `${url.replace(/\/$/, "")}/rest/v1/${input.table}?select=${encodeURIComponent(input.select ?? "*")}&limit=${input.limit ?? 10}`;
      const response = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          "apikey": decrypted,
          "Authorization": `Bearer ${decrypted}`,
          "Content-Type": "application/json"
        }
      });
      
      if (!response.ok) {
        return { error: `Erro do Supabase Externo: ${response.status} - ${await response.text()}` };
      }
      
      const data = await response.json();
      return { data };
    } catch (err) {
      return { error: `Erro de rede: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
