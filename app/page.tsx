import { traduzir } from "@/lib/i18n/dicionario";
import Link from "next/link";
import { ArrowRight, Bot, Zap, Shield, MessageSquare, CheckCircle2 } from "lucide-react";
import { InteractiveDemoChat } from "@/components/landing/InteractiveDemoChat";

export const metadata = {
  title: "KORTEX CRM - Inteligência Artificial, CRM e Atendimento em um Único Número",
  description: "Centralize suas vendas, automatize o follow-up e ganhe escala sem contratar mais pessoas.",
};

export const dynamic = "force-dynamic";

const t = (texto: string) => traduzir(texto, "pt-BR");

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#050505]/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Bot className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">KORTEX</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#funcionalidades" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors hidden md:block">Funcionalidades</a>
            <a href="#planos" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors hidden md:block">Planos</a>
            <Link
              href="/app"
              className="text-sm font-medium bg-white/10 hover:bg-white/20 text-white transition-colors px-5 py-2 rounded-full border border-white/10"
            >
              Acessar Sistema
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-24 px-6 overflow-hidden text-center">
          {/* Background Glows */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-emerald-600/10 blur-[120px] rounded-full pointer-events-none" />
          
          <div className="max-w-4xl mx-auto relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium mb-8 border border-emerald-500/20 backdrop-blur-md">
              <SparklesIcon className="w-4 h-4" />
              {t("O Sistema Operacional de Vendas")}
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight mb-6 leading-tight">
              {t("IA, CRM e Atendimento em um Único Número.")}
            </h1>
            <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto">
              {t("Centralize suas vendas, automatize o follow-up e ganhe escala sem contratar mais pessoas. Experimente agora mesmo.")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <a
                href="#planos"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-8 py-4 rounded-full font-bold transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-105"
              >
                {t("Ver Planos")} <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="#sandbox"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white px-8 py-4 rounded-full font-bold transition-colors border border-white/10"
              >
                {t("Testar Agentes")}
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500 font-medium">
              <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-400" /> Sem fidelidade</span>
              <span className="flex items-center gap-2"><Bot className="w-4 h-4 text-emerald-400" /> IA Treinada</span>
            </div>
          </div>
        </section>

        {/* Sandbox Section */}
        <section id="sandbox" className="pb-24 px-6 w-full relative z-20">
          <InteractiveDemoChat />
        </section>

        {/* Problema vs Solução (Benefícios) */}
        <section className="py-24 bg-[#0a0a0a] border-y border-white/5 relative">
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                {t("Você está perdendo vendas por falta de resposta rápida?")}
              </h2>
              <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
                {t("Enquanto seus concorrentes automatizam, sua operação ainda depende de planilhas soltas e da memória do atendente.")}
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-white/[0.02] p-8 rounded-3xl border border-white/5 hover:bg-white/[0.04] transition-colors flex flex-col gap-4 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                  <Bot className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">{t("Atendimento 24/7 com IA")}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{t("Não deixe o cliente esfriar na madrugada. Nossa IA treinada qualifica leads a qualquer hora, como se fosse um vendedor especialista.")}</p>
              </div>
              <div className="bg-white/[0.02] p-8 rounded-3xl border border-white/5 hover:bg-white/[0.04] transition-colors flex flex-col gap-4 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-400 border border-teal-500/20">
                  <Zap className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">{t("CRM Kanban Visual")}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{t("Veja onde cada negociação trava, mova cards entre etapas e entenda o fluxo real do seu time num único olhar.")}</p>
              </div>
              <div className="bg-white/[0.02] p-8 rounded-3xl border border-white/5 hover:bg-white/[0.04] transition-colors flex flex-col gap-4 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">{t("Automação que não dorme")}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{t("Identifique leads parados e acione gatilhos automaticamente. Nada esfria sem motivo na nossa plataforma.")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Premium Features */}
        <section id="funcionalidades" className="py-32 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 text-teal-400 text-sm font-medium mb-6 border border-teal-500/20">
              <Zap className="w-4 h-4" />
              {t("Funcionalidades Premium")}
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              {t("A plataforma que multiplica suas vendas.")}
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-16 items-center mb-32">
            <div className="order-2 md:order-1 relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full" />
              <div className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
                <div className="flex gap-4 items-start p-4 bg-white/5 rounded-xl border border-white/5 mb-4">
                   <Bot className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                   <div>
                     <p className="text-sm text-zinc-300 font-medium">Copiloto Integrado</p>
                     <p className="text-xs text-zinc-500 mt-1">A IA sugere a melhor resposta para o atendente humano, ou assume a conversa baseada no seu catálogo e histórico de vendas.</p>
                   </div>
                </div>
                <div className="flex gap-4 items-start p-4 bg-white/5 rounded-xl border border-white/5">
                   <MessageSquare className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                   <div>
                     <p className="text-sm text-zinc-300 font-medium">Departamentos & Times</p>
                     <p className="text-xs text-zinc-500 mt-1">Organize times e fluxos por setor. Vários atendentes no mesmo número, com distribuição inteligente e relatórios por pessoa.</p>
                   </div>
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <h3 className="text-3xl font-bold text-white mb-4">Uma IA treinada para o seu negócio.</h3>
              <p className="text-zinc-400 text-lg mb-6 leading-relaxed">
                Nada de chatbot genérico. Nossa inteligência aprende com seu material, FAQs e tom de voz para responder como se fosse do seu time. Escala instantânea sem precisar contratar.
              </p>
              <ul className="space-y-3 text-zinc-300">
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Respostas instantâneas e personalizadas</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Atendimento unificado multicanal</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Histórico cross-canal unificado no CRM</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Pricing Plans */}
        <section id="planos" className="py-24 bg-[#0a0a0a] border-t border-white/5 relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-emerald-900/10 blur-[120px] pointer-events-none" />
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                {t("Escolha o plano. Cresça sem mudar de stack.")}
              </h2>
              <p className="text-zinc-400 max-w-2xl mx-auto">
                {t("Sem fidelidade. Cancele quando quiser. Implantação rápida para acelerar suas vendas.")}
              </p>
            </div>

            <div className="grid lg:grid-cols-3 gap-8 items-stretch">
              {/* Standard */}
              <div className="bg-[#050505] rounded-3xl p-8 border border-white/10 flex flex-col hover:border-white/20 transition-colors">
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-white mb-2">Standard</h3>
                  <p className="text-zinc-400 text-sm h-10">Foco em Operações Iniciais e organização do atendimento.</p>
                </div>
                <ul className="space-y-4 text-sm text-zinc-300 flex-1 mb-8">
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> 1 Número Conectado</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Até 5 Atendentes</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> 1 Workflow de Automação</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> CRM Kanban Básico</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Suporte Online</li>
                </ul>
                <a
                  href="https://wa.me/5516997925854?text=Olá,%20gostaria%20de%20saber%20mais%20sobre%20o%20plano%20Standard."
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-4 text-center rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium border border-white/10 transition-colors"
                >
                  Falar com Vendas
                </a>
              </div>

              {/* Pro (Highlighted) */}
              <div className="bg-gradient-to-b from-emerald-900/40 to-[#050505] rounded-3xl p-8 border border-emerald-500/30 flex flex-col relative transform lg:-translate-y-4 shadow-2xl shadow-emerald-500/10 backdrop-blur-xl">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                  Recomendado
                </div>
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-emerald-400 mb-2">Pro</h3>
                  <p className="text-zinc-300 text-sm h-10">Para times que querem escala e Inteligência Artificial Avançada.</p>
                </div>
                <ul className="space-y-4 text-sm text-zinc-200 flex-1 mb-8">
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> Tudo do plano Standard</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> Inteligência Artificial Integrada</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> Até 15 Atendentes</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> Múltiplos Departamentos</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> Integrações via API (Webhooks)</li>
                </ul>
                <a
                  href="https://wa.me/5516997925854?text=Olá,%20tenho%20interesse%20em%20garantir%20o%20plano%20Pro."
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-4 text-center rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all shadow-lg shadow-emerald-500/25"
                >
                  Garantir Plano Pro
                </a>
              </div>

              {/* Enterprise */}
              <div className="bg-[#050505] rounded-3xl p-8 border border-white/10 flex flex-col hover:border-white/20 transition-colors">
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-white mb-2">Enterprise</h3>
                  <p className="text-zinc-400 text-sm h-10">Gestão completa para Grandes Operações e Funções Ilimitadas.</p>
                </div>
                <ul className="space-y-4 text-sm text-zinc-300 flex-1 mb-8">
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Tudo do plano Pro</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Atendentes e Departamentos Ilimitados</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Workflows Avançados Ilimitados</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Módulo de Documentos</li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-600 flex-shrink-0" /> Suporte Prioritário e Treinamento</li>
                </ul>
                <a
                  href="https://wa.me/5516997925854?text=Olá,%20preciso%20de%20uma%20solução%20Enterprise."
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-4 text-center rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium border border-white/10 transition-colors"
                >
                  Consultoria Especializada
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="py-24 text-center border-t border-white/5 bg-[#050505] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/10 to-transparent pointer-events-none" />
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6 relative z-10">{t("Receba uma proposta personalizada.")}</h2>
          <p className="text-zinc-400 mb-10 max-w-xl mx-auto relative z-10">Nosso time entende seu momento, seu volume e monta um plano sob medida. Resposta rápida para você começar a escalar hoje.</p>
          <div className="flex justify-center relative z-10">
            <a
              href="https://wa.me/5516997925854?text=Olá,%20gostaria%20de%20receber%20uma%20proposta."
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-white hover:bg-zinc-200 text-black px-8 py-4 rounded-full font-bold transition-transform hover:scale-105"
            >
              Falar com a Equipe <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
