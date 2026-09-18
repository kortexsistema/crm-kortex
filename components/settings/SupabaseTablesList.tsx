"use client";

import { useEffect, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { 
  getSupabaseTables, 
  addSupabaseTable, 
  deleteSupabaseTable 
} from "@/app/actions/integrations/supabaseTables";

// Type based on our schema
interface SupabaseIntegrationTable {
  id: string;
  table_name: string;
  filter_column: string;
  return_columns: string[];
  instruction: string;
}

export function SupabaseTablesList({ integrationId }: { integrationId: string }) {
  const t = useT();
  const [tables, setTables] = useState<SupabaseIntegrationTable[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [tableName, setTableName] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [returnColumns, setReturnColumns] = useState(""); // Comma separated for input
  const [instruction, setInstruction] = useState("");
  const [adding, setAdding] = useState(false);

  const loadTables = async () => {
    setLoading(true);
    try {
      const res = await getSupabaseTables(integrationId);
      if (res.ok && res.data) {
        setTables(res.data as SupabaseIntegrationTable[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, [integrationId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableName || !filterColumn || !returnColumns || !instruction) {
      toast.error(t("Preencha todos os campos da tabela."));
      return;
    }
    
    setAdding(true);
    try {
      const colsArray = returnColumns.split(",").map(c => c.trim()).filter(Boolean);
      const res = await addSupabaseTable(
        integrationId,
        tableName,
        filterColumn,
        colsArray,
        instruction
      );
      
      if (res.ok) {
        toast.success(t("Tabela configurada com sucesso."));
        // Reset form
        setTableName("");
        setFilterColumn("");
        setReturnColumns("");
        setInstruction("");
        loadTables();
      } else {
        toast.error(res.error?.message || t("Erro ao adicionar tabela."));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("Erro inesperado."));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("Tem certeza que deseja remover esta configuração?"))) return;
    
    try {
      const res = await deleteSupabaseTable(id);
      if (res.ok) {
        toast.success(t("Tabela removida com sucesso."));
        loadTables();
      } else {
        toast.error(res.error?.message || t("Erro ao remover tabela."));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("Erro inesperado."));
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">{t("Ferramentas de Busca (Tabelas Mapeadas)")}</CardTitle>
        <CardDescription>
          {t("Configure quais tabelas o Agente de IA poderá consultar usando a conexão acima.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* List existing tables */}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("Carregando tabelas...")}</p>
        ) : tables.length > 0 ? (
          <div className="space-y-4">
            {tables.map(table => (
              <div key={table.id} className="p-4 border rounded-md flex justify-between items-start bg-muted/20">
                <div className="space-y-1">
                  <p className="font-medium text-sm">{table.table_name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">Filtro:</span> {table.filter_column} |{" "}
                    <span className="font-semibold">Retorno:</span> {table.return_columns.join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2 italic">"{table.instruction}"</p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(table.id)}>
                  {t("Remover")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {t("Nenhuma tabela mapeada ainda. O agente não poderá consultar dados externos.")}
          </p>
        )}

        <hr />

        {/* Add new table form */}
        <div>
          <h3 className="text-sm font-medium mb-4">{t("Mapear Nova Tabela")}</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="table_name">{t("Tabela Alvo")}</Label>
                <Input
                  id="table_name"
                  placeholder="ex: agendamentos_pericia"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filter_column">{t("Coluna de Filtro (Chave de Busca)")}</Label>
                <Input
                  id="filter_column"
                  placeholder="ex: cpf"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="return_columns">{t("Colunas de Retorno (separadas por vírgula)")}</Label>
              <Input
                id="return_columns"
                placeholder="ex: status, data_pericia, horario"
                value={returnColumns}
                onChange={(e) => setReturnColumns(e.target.value)}
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="instruction">{t("Instrução / Contexto para o Agente")}</Label>
              <Textarea
                id="instruction"
                placeholder="Explique à IA o objetivo da tabela. Ex: Use esta tabela para consultar o status da perícia informando o CPF do cliente."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
              />
            </div>

            <Button type="submit" disabled={adding} variant="secondary">
              {adding ? t("Adicionando...") : t("Adicionar Ferramenta de Busca")}
            </Button>
          </form>
        </div>

      </CardContent>
    </Card>
  );
}
