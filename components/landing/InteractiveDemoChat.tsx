"use client";

import { useState } from "react";
import { Scale, GraduationCap, Stethoscope, Home } from "lucide-react";
import { traduzir } from "@/lib/i18n/dicionario";

// ============================================================================
// MAPEAMENTO DAS URLs DOS AGENTES KORTEX (WEBCHAT)
// Insira aqui os links fornecidos pela plataforma para o embed de cada nicho
// ============================================================================
const AGENT_CONFIGS = [
  { 
    id: "advocacia", 
    label: "Advocacia Previdenciária", 
    icon: Scale,
    title: "Agente Previdenciário",
    desc: "Simulação de triagem de clientes e cálculo preliminar de tempo de contribuição.",
    url: "https://seulink-chat-advocacia.com" // <- INSIRA O LINK AQUI
  },
  { 
    id: "educacao", 
    label: "Educação / Escola", 
    icon: GraduationCap,
    title: "Agente Educacional",
    desc: "Atendimento automatizado a pais, dúvidas sobre matrículas e informações de cursos.",
    url: "https://seulink-chat-educacao.com" // <- INSIRA O LINK AQUI
  },
  { 
    id: "clinica", 
    label: "Clínica / Odontologia", 
    icon: Stethoscope,
    title: "Agente Odontológico",
    desc: "Pré-agendamento de consultas, dúvidas frequentes e orçamentos base.",
    url: "https://seulink-chat-clinica.com" // <- INSIRA O LINK AQUI
  },
  { 
    id: "imobiliaria", 
    label: "Imobiliária", 
    icon: Home,
    title: "Agente Imobiliário",
    desc: "Busca inteligente de imóveis, captação de leads e agendamento de visitas.",
    url: "https://seulink-chat-imobiliaria.com" // <- INSIRA O LINK AQUI
  },
];

export function InteractiveDemoChat() {
  const t = (texto: string) => traduzir(texto, "pt-BR");
  const [activeNiche, setActiveNiche] = useState(AGENT_CONFIGS[0]!);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleNicheChange = (niche: typeof AGENT_CONFIGS[0]) => {
    if (activeNiche.id === niche.id) return;
    
    // Inicia a transição de saída (Fade Out)
    setIsTransitioning(true);
    
    // Aguarda o fade out terminar para trocar a URL e iniciar o fade in
    setTimeout(() => {
      setActiveNiche(niche);
      setIsTransitioning(false);
    }, 300);
  };

  return (
    <div className="flex flex-col h-[650px] max-w-4xl mx-auto border border-zinc-800 rounded-2xl overflow-hidden bg-[#121212] shadow-2xl">
      
      {/* Menu Superior de Abas (Estilo Pílula) */}
      <div className="flex overflow-x-auto bg-[#1a1a1a] border-b border-zinc-800 p-3 scrollbar-hide justify-center gap-3">
        {AGENT_CONFIGS.map((niche) => {
          const Icon = niche.icon;
          const isActive = activeNiche.id === niche.id;
          return (
            <button
              key={niche.id}
              onClick={() => handleNicheChange(niche)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                isActive
                  ? "bg-sky-600 text-white shadow-[0_0_15px_rgba(2,132,199,0.5)]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(niche.label)}
            </button>
          );
        })}
      </div>

      {/* Header do Container Central (Status da Demonstração) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center p-4 bg-[#1a1a1a] border-b border-zinc-800">
        <div className="flex items-center gap-2 text-zinc-100 font-semibold text-sm md:text-base">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)] animate-pulse" />
          {t("Demonstração Ativa:")}{" "}
          <span className="text-sky-400 transition-opacity duration-300" style={{ opacity: isTransitioning ? 0 : 1 }}>
            {t(activeNiche.label)}
          </span>
        </div>
        <div 
          className="text-zinc-400 text-xs md:text-sm max-w-md text-left md:text-right mt-2 md:mt-0 transition-opacity duration-300"
          style={{ opacity: isTransitioning ? 0 : 1 }}
        >
          {t(activeNiche.desc)}
        </div>
      </div>

      {/* Corpo (Iframe do Chat Kortex) */}
      <div className="flex-1 w-full bg-[#111b21] relative overflow-hidden">
        
        {/* Placeholder explicativo no fundo (caso o Iframe falhe ou a URL esteja vazia) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6 text-center z-0 opacity-30">
          <div className="border border-dashed border-emerald-500/50 bg-emerald-500/5 p-4 rounded-xl text-emerald-400 font-mono text-sm max-w-md">
            &lt;!-- O Iframe carregará aqui. Substitua a propriedade "url" de cada nicho em AGENT_CONFIGS no código fonte. --&gt;
          </div>
        </div>

        {/* Iframe que carrega o chat ativo */}
        <iframe
          src={activeNiche.url}
          title={t(activeNiche.title)}
          className="w-full h-full border-none transition-opacity duration-300 relative z-10 bg-transparent"
          style={{ opacity: isTransitioning ? 0 : 1 }}
        />
      </div>
    </div>
  );
}
