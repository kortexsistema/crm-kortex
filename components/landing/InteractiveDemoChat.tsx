"use client";

import { useState } from "react";
import { Scale, GraduationCap, Stethoscope, Home, MessageCircle } from "lucide-react";
import { traduzir } from "@/lib/i18n/dicionario";

const WHATSAPP_NUMBER = "5516997925854";

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
    url: `https://wa.me/${WHATSAPP_NUMBER}?text=Quero%20testar%20o%20agente%20de%20Advocacia`
  },
  {
    id: "educacao",
    label: "Educação / Escola",
    icon: GraduationCap,
    title: "Agente Educacional",
    desc: "Atendimento automatizado a pais, dúvidas sobre matrículas e informações de cursos.",
    url: `https://wa.me/${WHATSAPP_NUMBER}?text=Quero%20testar%20o%20agente%20de%20Educacao`
  },
  {
    id: "clinica",
    label: "Clínica / Odontologia",
    icon: Stethoscope,
    title: "Agente Odontológico",
    desc: "Pré-agendamento de consultas, dúvidas frequentes e orçamentos base.",
    url: `https://wa.me/${WHATSAPP_NUMBER}?text=Quero%20testar%20o%20agente%20de%20Clinica`
  },
  {
    id: "imobiliaria",
    label: "Imobiliária",
    icon: Home,
    title: "Agente Imobiliário",
    desc: "Busca inteligente de imóveis, captação de leads e agendamento de visitas.",
    url: `https://wa.me/${WHATSAPP_NUMBER}?text=Quero%20testar%20o%20agente%20de%20Imobiliaria`
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
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 whitespace-nowrap ${isActive
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

      {/* Corpo (WhatsApp CTA) */}
      <div className="flex-1 w-full bg-[#111b21] relative overflow-hidden flex flex-col items-center justify-center p-6 text-center">

        {/* Background Effects (Glassmorphism & Gradients) */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[#25D366]/20 rounded-full blur-[80px]" />
        </div>

        <div
          className="relative z-10 flex flex-col items-center gap-6 max-w-md w-full transition-opacity duration-300"
          style={{ opacity: isTransitioning ? 0 : 1 }}
        >
          {/* Ícone do WhatsApp estizado */}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#25D366] to-[#1DA851] flex items-center justify-center shadow-[0_0_40px_rgba(37,211,102,0.4)] mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" className="text-white" viewBox="0 0 16 16">
              <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c-.003 1.396.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
            </svg>
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-white">
              Teste o {t(activeNiche.title)}
            </h3>
            <p className="text-zinc-400 max-w-sm mx-auto">
              {t("Experimente na prática como nosso agente de IA atende pelo WhatsApp.")}
            </p>
          </div>

          <a
            href={activeNiche.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-3 w-full sm:w-auto px-8 py-4 bg-[#25D366] hover:bg-[#1DA851] text-white font-bold rounded-full transition-all duration-300 hover:scale-105 shadow-[0_4px_20px_rgba(37,211,102,0.3)] hover:shadow-[0_6px_25px_rgba(37,211,102,0.4)]"
          >
            <MessageCircle className="w-5 h-5" />
            {t("Testar no WhatsApp")}
          </a>
        </div>
      </div>
    </div>
  );
}
