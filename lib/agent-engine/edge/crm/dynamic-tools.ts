import { tool, type Tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditMcpToolCall } from "@/lib/mcp/audit";
import type { McpContext } from "@/lib/mcp/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function buildDynamicSupabaseTools(
  supabase: SupabaseClient,
  ctx: McpContext
): Promise<Record<string, Tool>> {
  const result: Record<string, Tool> = {};

  // Fetch the active external_supabase integration for this tenant
  const { data: integration } = await supabase
    .from("tenant_integrations")
    .select("id, store_metadata, oauth_access_token_encrypted")
    .eq("organization_id", ctx.organizationId)
    .eq("provider", "external_supabase")
    .eq("status", "healthy")
    .maybeSingle();

  if (!integration) return result;

  const url = (integration.store_metadata as Record<string, unknown>)?.supabase_url as string | undefined;
  if (!url) return result;

  // Fetch the mapped tables
  const { data: tables } = await supabase
    .from("supabase_integration_tables")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("integration_id", integration.id);

  if (!tables || tables.length === 0) return result;

  // For each table, create a specific tool
  for (const t of tables) {
    const toolName = `consultar_externo_${t.table_name}`;
    
    // We dynamically build the schema requiring the specified filter_column
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    schemaShape[t.filter_column] = z.string().describe(`Valor do filtro para buscar na coluna ${t.filter_column}`);
    const inputSchema = z.object(schemaShape);

    result[toolName] = tool({
      description: t.instruction,
      inputSchema,
      execute: async (args: unknown) => {
        const startedAt = Date.now();
        const argsRecord = (args ?? {}) as Record<string, unknown>;
        const filterValue = argsRecord[t.filter_column];

        try {
          // Decrypt key using admin client
          const admin = createAdminClient();
          const { data: decrypted, error: decErr } = await admin.rpc("fn_decrypt_oauth", {
            ciphertext: integration.oauth_access_token_encrypted,
          });
          
          if (decErr || !decrypted) {
            throw new Error("Falha ao descriptografar chave de API externa.");
          }

          // Build query URL
          const selectParam = encodeURIComponent(t.return_columns.join(","));
          const filterParam = encodeURIComponent(`eq.${filterValue}`);
          const fetchUrl = `${url.replace(/\/$/, "")}/rest/v1/${t.table_name}?select=${selectParam}&${t.filter_column}=${filterParam}&limit=10`;
          
          const response = await fetch(fetchUrl, {
            method: "GET",
            headers: {
              "apikey": decrypted,
              "Authorization": `Bearer ${decrypted}`,
              "Content-Type": "application/json"
            }
          });
          
          if (!response.ok) {
            throw new Error(`Erro na API externa: ${response.status}`);
          }
          
          const data = await response.json();
          
          void auditMcpToolCall({
            ctx,
            toolName,
            args: argsRecord,
            durationMs: Date.now() - startedAt,
            success: true,
          });
          
          return { data };
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown_error";
          void auditMcpToolCall({
            ctx,
            toolName,
            args: argsRecord,
            durationMs: Date.now() - startedAt,
            success: false,
            errorMessage: message,
          });
          return { error: message };
        }
      },
    });

    // Se houver status_mapping e for uma tabela de compromissos, podemos criar a tool de atualização
    if (t.status_mapping && Object.keys(t.status_mapping).length > 0) {
      const updateToolName = `atualizar_status_${t.table_name}`;
      const statusMap = t.status_mapping as Record<string, string>;
      
      const updateSchemaShape: Record<string, z.ZodTypeAny> = {
        id: z.string().describe(`ID do registro na tabela ${t.table_name} para atualizar`),
        novo_status: z.string().describe(`O novo status (ex: '${statusMap.confirmed_value}' para confirmar, '${statusMap.reschedule_value}' para remarcar)`),
      };

      result[updateToolName] = tool({
        description: `Atualiza o status de um registro na tabela ${t.table_name} no banco de dados externo. Use após consultar o ID correto.`,
        inputSchema: z.object(updateSchemaShape),
        execute: async (args: unknown) => {
          const startedAt = Date.now();
          const argsRecord = (args ?? {}) as Record<string, string>;
          const { id, novo_status } = argsRecord;

          try {
            const admin = createAdminClient();
            const { data: decrypted, error: decErr } = await admin.rpc("fn_decrypt_oauth", {
              ciphertext: integration.oauth_access_token_encrypted,
            });
            if (decErr || !decrypted) throw new Error("Falha ao descriptografar chave.");

            const updateUrl = `${url.replace(/\/$/, "")}/rest/v1/${t.table_name}?id=eq.${id}`;
            const response = await fetch(updateUrl, {
              method: "PATCH",
              headers: {
                "apikey": decrypted,
                "Authorization": `Bearer ${decrypted}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({
                [statusMap.status_column || "status"]: novo_status
              })
            });
            
            if (!response.ok) throw new Error(`Erro na API externa: ${response.status}`);
            
            void auditMcpToolCall({ ctx, toolName: updateToolName, args: argsRecord, durationMs: Date.now() - startedAt, success: true });
            return { data: { success: true, updated_id: id, status: novo_status } };
          } catch (err) {
            const message = err instanceof Error ? err.message : "unknown_error";
            void auditMcpToolCall({ ctx, toolName: updateToolName, args: argsRecord, durationMs: Date.now() - startedAt, success: false, errorMessage: message });
            return { error: message };
          }
        }
      });
    }
  }

  return result;
}
