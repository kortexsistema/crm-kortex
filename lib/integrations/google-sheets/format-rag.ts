/**
 * Formata um produto do catálogo para documento de texto puro adequado ao RAG e embeddings.
 */

export interface CatalogProductForRag {
  codigo: string;
  nome: string;
  preco_cents: number;
  custo_cents?: number | null;
  marca?: string | null;
  categoria?: string | null;
  quantidade: number;
  controla_estoque: boolean;
  moeda?: string | null;
}

export function formatCatalogProductForRag(p: CatalogProductForRag): string {
  const preco = (p.preco_cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moeda = p.moeda ?? "BRL";
  const estoque = p.controla_estoque
    ? `${p.quantidade} unidade(s) em estoque`
    : "Disponível (sem controle rígido de quantidade)";

  const lines: string[] = [
    `Produto: ${p.nome}`,
    `Código / SKU: ${p.codigo}`,
    `Preço: ${moeda} ${preco}`,
    `Disponibilidade / Estoque: ${estoque}`,
  ];

  if (p.marca) {
    lines.push(`Marca: ${p.marca}`);
  }
  if (p.categoria) {
    lines.push(`Categoria: ${p.categoria}`);
  }

  return lines.join("\n");
}
