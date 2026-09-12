import Link from "next/link";
import { ArrowRight, Bot, Zap, Shield, MessageSquare } from "lucide-react";
import { InteractiveDemoChat } from "@/components/landing/InteractiveDemoChat";

export const metadata = {
  title: "KORTEX CRM - O Sistema Operacional de Vendas com IA",
  description: "Automação de vendas, qualificação e atendimento via WhatsApp impulsionados por Inteligência Artificial.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-zinc-200 font-sans selection:bg-sky-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-[#0f0f0f]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
              <Bot className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">KORTEX CRM</span>
          </div>
          <nav>
            <Link
              href="/app"
              className="text-sm font-medium hover:text-sky-400 transition-colors px-4 py-2"
            >
              Acessar Sistema
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="pt-32 pb-20 px-6 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 text-sky-400 text-sm font-medium mb-8 border border-sky-500/20">
            <SparklesIcon className="w-4 h-4" />
            Agentes de IA Nativos
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-6 leading-tight">
            Venda no automático. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-600">
              Qualifique em segundos.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto">
            O CRM inteligente que atende seus clientes 24h por dia no WhatsApp, entende o que eles buscam e já prepara tudo para você fechar a venda.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-8 py-4 rounded-full font-medium transition-transform hover:scale-105"
            >
              Começar Agora <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#sandbox"
              className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-4 rounded-full font-medium transition-colors border border-zinc-700"
            >
              Testar Agente
            </a>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-[#141414] border-y border-zinc-800">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-[#1a1a1a] p-8 rounded-2xl border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-sky-500/10 flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6 text-sky-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Sem Latência</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Respostas instantâneas integradas diretamente ao WhatsApp via WAHA, sem intermediários caros.
                </p>
              </div>
              <div className="bg-[#1a1a1a] p-8 rounded-2xl border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-6">
                  <MessageSquare className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Multi-nicho</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Pronto para clínicas, escolas, imobiliárias ou e-commerce. A IA se adapta perfeitamente ao seu negócio.
                </p>
              </div>
              <div className="bg-[#1a1a1a] p-8 rounded-2xl border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-6">
                  <Shield className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Segurança Total</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Self-hosted e LGPD-first. Você é dono dos seus dados e das conversas dos seus clientes.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Sandbox Section */}
        <section id="sandbox" className="py-24 px-6 max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Experimente a IA ao vivo
            </h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">
              Escolha um nicho abaixo e converse com nosso agente de demonstração. Descubra como ele qualifica leads e agenda atendimentos naturalmente.
            </p>
          </div>
          
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-sky-500/20 to-blue-600/20 blur-3xl -z-10 rounded-full opacity-50" />
            <InteractiveDemoChat />
          </div>
        </section>

        {/* CTA Footer */}
        <section className="py-24 text-center border-t border-zinc-800 bg-[#0f0f0f]">
          <h2 className="text-3xl font-bold text-white mb-6">Pronto para escalar seu atendimento?</h2>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 bg-white hover:bg-zinc-200 text-black px-8 py-4 rounded-full font-bold transition-transform hover:scale-105"
          >
            Acessar o Painel <ArrowRight className="w-4 h-4" />
          </Link>
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
