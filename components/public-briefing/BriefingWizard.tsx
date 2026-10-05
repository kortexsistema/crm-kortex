"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, ChevronLeft, Send } from "lucide-react";

const briefingSchema = z.object({
  empresa: z.string().min(2, "Obrigatório"),
  segmento: z.string().min(2, "Obrigatório"),
  endereco: z.string().min(2, "Obrigatório"),
  telefone: z.string().min(8, "Obrigatório"),
  horarioFuncionamento: z.string().min(5, "Informe o horário de abertura e fechamento"),
  descricao: z.string().min(10, "Descreva melhor o seu negócio"),

  nomeAssistente: z.string().min(2, "Obrigatório"),
  tomDeVoz: z.string().min(2, "Obrigatório"),
  regrasOuro: z.string().min(5, "Informe o que não deve ser feito de jeito nenhum"),
  restricoes: z.string().optional(),

  catalogo: z.string().min(5, "Informe seus principais serviços/produtos"),
  pagamento: z.string().min(2, "Quais as formas de pagamento aceites?"),
  politicas: z.string().min(2, "Quais as políticas de atendimento/agendamento/venda?"),

  escopoSim: z.string().min(5, "O que a IA deve fazer ativamente?"),
  escopoNao: z.string().min(5, "O que está fora do escopo absoluto?"),
  handoff: z.string().min(5, "Quando e como transferir para o humano?"),
  funcionariosHandoff: z.string().min(2, "Quais funcionários/cargos receberão o atendimento?"),

  emailResponsavel: z.string().email("E-mail inválido"),
  whatsappCliente: z.string().min(10, "WhatsApp com DDD (Ex: 11999999999)"),
});

type BriefingData = z.infer<typeof briefingSchema>;

const STEPS = [
  { id: 1, title: "Informações Básicas" },
  { id: 2, title: "Persona & Regras" },
  { id: 3, title: "Catálogo & Preços" },
  { id: 4, title: "Fluxo & Escopo" },
  { id: 5, title: "Finalização" },
];

export function BriefingWizard() {
  const [currentStep, setCurrentStep] = useState(1);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<BriefingData>({
    resolver: zodResolver(briefingSchema),
    mode: "onTouched",
  });

  const handleNext = async () => {
    let fieldsToValidate: (keyof BriefingData)[] = [];
    if (currentStep === 1) fieldsToValidate = ["empresa", "segmento", "endereco", "telefone", "horarioFuncionamento", "descricao"];
    if (currentStep === 2) fieldsToValidate = ["nomeAssistente", "tomDeVoz", "regrasOuro", "restricoes"];
    if (currentStep === 3) fieldsToValidate = ["catalogo", "pagamento", "politicas"];
    if (currentStep === 4) fieldsToValidate = ["escopoSim", "escopoNao", "handoff", "funcionariosHandoff"];
    
    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setCurrentStep((prev) => Math.min(prev + 1, 5));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onSubmit = (data: BriefingData) => {
    const message = `
*📋 NOVO BRIEFING - AGENTE DE IA*

*1️⃣ Informações Básicas*
*Empresa:* ${data.empresa}
*Segmento:* ${data.segmento}
*Endereço:* ${data.endereco}
*Telefone:* ${data.telefone}
*Horário de Funcionamento:* ${data.horarioFuncionamento}
*Descrição:* ${data.descricao}

*2️⃣ Persona e Regras*
*Nome do Assistente:* ${data.nomeAssistente}
*Tom de Voz:* ${data.tomDeVoz}
*Regras de Ouro:* ${data.regrasOuro}
*Restrições:* ${data.restricoes || "Nenhuma especificada"}

*3️⃣ Catálogo e Regras de Negócio*
*Catálogo:* ${data.catalogo}
*Pagamento:* ${data.pagamento}
*Políticas de Atendimento:* ${data.politicas}

*4️⃣ Fluxo e Escopo*
*No Escopo (Deve fazer):* ${data.escopoSim}
*Fora do Escopo:* ${data.escopoNao}
*Regra de Handoff:* ${data.handoff}
*Cargos para Handoff:* ${data.funcionariosHandoff}

*5️⃣ Contato do Cliente*
*E-mail:* ${data.emailResponsavel}
*WhatsApp do Cliente:* ${data.whatsappCliente}
    `.trim();

    const targetNumber = "5516981518607"; // Número hardcoded para receber o briefing
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${targetNumber}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, "_blank");
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 md:flex-row">
      {/* Sidebar de Progresso */}
      <div className="w-full shrink-0 md:w-64">
        <div className="sticky top-8 rounded-xl bg-card p-6 shadow-sm border border-border">
          <h2 className="mb-6 text-lg font-semibold tracking-tight">Etapas do Briefing</h2>
          <nav className="flex flex-col gap-4">
            {STEPS.map((step) => {
              const isActive = currentStep === step.id;
              const isPast = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium transition-colors ${
                    isActive ? "border-primary bg-primary text-primary-foreground" 
                    : isPast ? "border-primary bg-primary/10 text-primary" 
                    : "border-muted-foreground/30 text-muted-foreground"
                  }`}>
                    {isPast ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.title}
                  </span>
                </div>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Formulário Principal */}
      <Card className="flex-1 overflow-hidden shadow-sm">
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="p-6 md:p-8">
            <div className={currentStep === 1 ? "block" : "hidden"}>
              <h3 className="mb-4 text-2xl font-bold tracking-tight">Identidade e Informações Básicas</h3>
              <p className="mb-8 text-muted-foreground">Vamos começar por conhecer um pouco melhor o negócio onde a IA vai atuar.</p>
              
              <div className="grid gap-6">
                <div className="space-y-2">
                  <Label htmlFor="empresa">Nome da Empresa / Negócio</Label>
                  <Input id="empresa" placeholder="Ex: Clínica Sorriso Perfeito" {...register("empresa")} />
                  {errors.empresa && <p className="text-sm text-destructive">{errors.empresa.message}</p>}
                </div>
                
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="segmento">Segmento / Nicho</Label>
                    <Input id="segmento" placeholder="Ex: Odontologia" {...register("segmento")} />
                    {errors.segmento && <p className="text-sm text-destructive">{errors.segmento.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="telefone">Telefone Principal da Empresa</Label>
                    <Input id="telefone" placeholder="Ex: 11999999999" {...register("telefone")} />
                    {errors.telefone && <p className="text-sm text-destructive">{errors.telefone.message}</p>}
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="endereco">Endereço ou Tipo de Atendimento</Label>
                    <Input id="endereco" placeholder="Ex: Rua das Flores, 123 ou 'Online'" {...register("endereco")} />
                    {errors.endereco && <p className="text-sm text-destructive">{errors.endereco.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="horarioFuncionamento">Horário de Funcionamento</Label>
                    <Input id="horarioFuncionamento" placeholder="Ex: Seg a Sex das 08h às 18h" {...register("horarioFuncionamento")} />
                    {errors.horarioFuncionamento && <p className="text-sm text-destructive">{errors.horarioFuncionamento.message}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="descricao">Descrição Breve do Negócio</Label>
                  <Textarea id="descricao" className="h-24" placeholder="Explique brevemente o que vocês fazem, quem é a equipe e qual o diferencial principal..." {...register("descricao")} />
                  {errors.descricao && <p className="text-sm text-destructive">{errors.descricao.message}</p>}
                </div>
              </div>
            </div>

            <div className={currentStep === 2 ? "block" : "hidden"}>
              <h3 className="mb-4 text-2xl font-bold tracking-tight">Persona, Tom de Voz e Guardrails</h3>
              <p className="mb-8 text-muted-foreground">Como o seu assistente de IA deve se comportar com os clientes?</p>

              <div className="grid gap-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nomeAssistente">Nome do Assistente Virtual</Label>
                    <Input id="nomeAssistente" placeholder="Ex: Marina (Assistente)" {...register("nomeAssistente")} />
                    {errors.nomeAssistente && <p className="text-sm text-destructive">{errors.nomeAssistente.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tomDeVoz">Tom de Voz</Label>
                    <Input id="tomDeVoz" placeholder="Ex: Amigável, acolhedor e profissional" {...register("tomDeVoz")} />
                    {errors.tomDeVoz && <p className="text-sm text-destructive">{errors.tomDeVoz.message}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="regrasOuro">Regras de Ouro (O que a IA NUNCA deve fazer)</Label>
                  <Textarea id="regrasOuro" className="h-32" placeholder="Ex: NUNCA inventar preços que não estão na tabela. NUNCA dar diagnósticos médicos. NUNCA prometer vagas sem confirmar antes na agenda." {...register("regrasOuro")} />
                  {errors.regrasOuro && <p className="text-sm text-destructive">{errors.regrasOuro.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="restricoes">Restrições Específicas de Vocabulário</Label>
                  <Input id="restricoes" placeholder="Ex: Não use emojis excessivamente. Não chame o cliente de 'querido'." {...register("restricoes")} />
                  {errors.restricoes && <p className="text-sm text-destructive">{errors.restricoes.message}</p>}
                </div>
              </div>
            </div>

            <div className={currentStep === 3 ? "block" : "hidden"}>
              <h3 className="mb-4 text-2xl font-bold tracking-tight">Catálogo e Regras de Negócio</h3>
              <p className="mb-8 text-muted-foreground">Quais são os produtos/serviços que a IA vai vender ou informar?</p>

              <div className="grid gap-6">
                <div className="space-y-2">
                  <Label htmlFor="catalogo">Principais Produtos, Serviços ou Planos</Label>
                  <Textarea id="catalogo" className="h-32" placeholder="Ex:&#10;1. Limpeza Dentária: R$ 200&#10;2. Avaliação Inicial: Gratuita&#10;3. Clareamento: R$ 800 (faixa)" {...register("catalogo")} />
                  {errors.catalogo && <p className="text-sm text-destructive">{errors.catalogo.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pagamento">Formas de Pagamento e Descontos</Label>
                  <Input id="pagamento" placeholder="Ex: PIX (10% de desconto), Cartão em até 12x sem juros" {...register("pagamento")} />
                  {errors.pagamento && <p className="text-sm text-destructive">{errors.pagamento.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="politicas">Políticas de Atendimento</Label>
                  <Textarea id="politicas" className="h-24" placeholder="Ex: Agendamentos exigem 50% de sinal. Prazo de entrega de 5 dias úteis. Pedimos os dados apenas para agendamento (LGPD)." {...register("politicas")} />
                  {errors.politicas && <p className="text-sm text-destructive">{errors.politicas.message}</p>}
                </div>
              </div>
            </div>

            <div className={currentStep === 4 ? "block" : "hidden"}>
              <h3 className="mb-4 text-2xl font-bold tracking-tight">Fluxo de Atendimento e Escopo</h3>
              <p className="mb-8 text-muted-foreground">Defina as fronteiras de atuação da sua Inteligência Artificial.</p>

              <div className="grid gap-6">
                <div className="space-y-2">
                  <Label htmlFor="escopoSim">O que a IA DEVE fazer (Missão Principal)</Label>
                  <Textarea id="escopoSim" className="h-24" placeholder="Ex: Triagem inicial, coletar o nome do paciente, perguntar qual a especialidade que precisa e agendar." {...register("escopoSim")} />
                  {errors.escopoSim && <p className="text-sm text-destructive">{errors.escopoSim.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="escopoNao">O que está FORA DO ESCOPO</Label>
                  <Textarea id="escopoNao" className="h-24" placeholder="Ex: Resolver reclamações complexas, tratar de reembolsos ou discutir orçamentos personalizados." {...register("escopoNao")} />
                  {errors.escopoNao && <p className="text-sm text-destructive">{errors.escopoNao.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="handoff">Regra de Handoff (Transferência para humano)</Label>
                  <Textarea id="handoff" className="h-24" placeholder="Ex: Se o cliente disser que é urgência/dor, transfira imediatamente para a equipe médica." {...register("handoff")} />
                  {errors.handoff && <p className="text-sm text-destructive">{errors.handoff.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="funcionariosHandoff">Funcionários e Cargos para receber Atendimento</Label>
                  <Input id="funcionariosHandoff" placeholder="Ex: Recepcionista (Ana) para agendamentos, Médico (Dr. João) para dúvidas técnicas." {...register("funcionariosHandoff")} />
                  {errors.funcionariosHandoff && <p className="text-sm text-destructive">{errors.funcionariosHandoff.message}</p>}
                </div>
              </div>
            </div>

            <div className={currentStep === 5 ? "block" : "hidden"}>
              <h3 className="mb-4 text-2xl font-bold tracking-tight">Finalização e Envio</h3>
              <p className="mb-8 text-muted-foreground">Quais são os seus dados de contato? O Briefing será enviado diretamente para a nossa equipe pelo WhatsApp.</p>

              <div className="grid gap-6">
                <div className="space-y-2">
                  <Label htmlFor="emailResponsavel">Seu E-mail</Label>
                  <Input id="emailResponsavel" type="email" placeholder="seu@email.com" {...register("emailResponsavel")} />
                  {errors.emailResponsavel && <p className="text-sm text-destructive">{errors.emailResponsavel.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsappCliente">Seu WhatsApp</Label>
                  <Input id="whatsappCliente" placeholder="Ex: 11999999999" {...register("whatsappCliente")} />
                  <p className="text-xs text-muted-foreground mt-1">Ao clicar em Enviar, você será direcionado para o nosso WhatsApp com o briefing preenchido.</p>
                  {errors.whatsappCliente && <p className="text-sm text-destructive">{errors.whatsappCliente.message}</p>}
                </div>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={handlePrev}
                disabled={currentStep === 1}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Anterior
              </Button>
              
              {currentStep < 5 ? (
                <Button type="button" onClick={handleNext}>
                  Próximo
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white">
                  <Send className="mr-2 h-4 w-4" />
                  Enviar Briefing via WhatsApp
                </Button>
              )}
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
