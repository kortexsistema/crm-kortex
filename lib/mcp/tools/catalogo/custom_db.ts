import { declararTools } from "./tipos";

export const TOOLS_CUSTOM_DB = declararTools([
  {
    name: "query_external_supabase",
    category: "read",
    rotulo: "Consultar Banco de Dados Externo",
    explicacao: "Consulta tabelas no banco de dados externo do cliente (Supabase de terceiros). Útil para ler estoque, pedidos customizados, ordens de serviço, etc.",
    oQueToca: "Banco de dados externo customizado",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
