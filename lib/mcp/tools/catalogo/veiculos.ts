/**
 * Capacidades de VEÍCULOS — consulta estruturada e segura do estoque automotivo.
 *
 * Ver contrato em docs/specs e testes em tests/unit/catalogo-tools-leigo-friendly.test.ts.
 * Restrito ao nicho 'vehicles' (concessionárias, lojas e revendas automotivas).
 */
import { declararTools } from "./tipos";

export const TOOLS_VEICULOS = declararTools([
  {
    name: "crm_search_vehicles",
    category: "read",
    requiresNiche: "vehicles",
    rotulo: "Buscar veículos no estoque",
    explicacao:
      "Pesquisa carros e motos disponíveis no estoque da loja por marca, modelo, ano ou valor para responder o cliente com exatidão.",
    oQueToca: "Estoque de veículos",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "crm_get_vehicle",
    category: "read",
    requiresNiche: "vehicles",
    rotulo: "Ver detalhes de um veículo",
    explicacao:
      "Mostra as informações comerciais completas de um carro do estoque, incluindo opcionais, fotos e situação de venda.",
    oQueToca: "Ficha do veículo",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
]);
