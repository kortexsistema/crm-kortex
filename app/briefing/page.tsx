import { Metadata } from "next";
import { BriefingWizard } from "@/components/public-briefing/BriefingWizard";

export const metadata: Metadata = {
  title: "Briefing de Agente de IA | Configuração Inicial",
  description: "Crie o briefing perfeito para o seu agente de inteligência artificial.",
};

export default function BriefingPage() {
  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4 md:py-24">
      <div className="mx-auto mb-12 max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl text-foreground">
          Crie o seu <span className="text-primary">Agente IA</span>
        </h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Preencha o formulário abaixo para configurarmos a identidade, as regras de negócio e a personalidade do seu assistente virtual. Quanto mais detalhes fornecer, melhor será o atendimento!
        </p>
      </div>

      <BriefingWizard />
    </div>
  );
}
