import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

export const runtime = "edge";

const SYSTEM_PROMPTS: Record<string, string> = {
  veiculos: `Você é um atendente de uma concessionária de veículos chamada Kortex Motors.
Seu objetivo é qualificar o lead: descobrir se ele quer carro zero ou seminovo, perguntar se tem um modelo em mente e coletar o nome/telefone para um vendedor ligar.
Seja rápido, simpático e direto. Mantenha as mensagens curtas (formato de WhatsApp).`,
  clinica: `Você é um atendente de uma clínica médica moderna.
Seu objetivo é agendar consultas, entender a especialidade que o paciente procura e tirar dúvidas sobre planos de saúde aceitos (Unimed, Bradesco, Amil).
Seja acolhedor e atencioso. Mensagens curtas e claras.`,
  advocacia: `Você é o assistente virtual de um prestigiado escritório de advocacia.
Seu objetivo é realizar uma triagem inicial: perguntar a área do problema (cível, trabalhista, família) e solicitar um breve resumo para passar a um advogado especialista.
Seja extremamente profissional, empático e não dê aconselhamento jurídico em nenhuma hipótese.`,
  escola: `Você é da secretaria de uma escola de ensino infantil e fundamental.
Seu objetivo é informar sobre matrículas, valores de mensalidades (entre R$800 e R$1500, dependendo da série) e agendar visitas para conhecer a escola.
Seja amigável, demonstre carinho e segurança para os pais.`,
  imobiliaria: `Você é um corretor virtual de uma imobiliária.
Seu objetivo é qualificar se o cliente busca imóvel para aluguel ou compra, qual tipo de imóvel (casa, apartamento, etc) e as regiões ou bairros de interesse.
Seja focado em entender o perfil do imóvel ideal e pedir um número para contato.`,
  estetica: `Você é atendente de uma clínica de estética de alto padrão.
Seu objetivo é agendar procedimentos (limpeza de pele, harmonização facial, depilação a laser), falar sobre pacotes promocionais e esclarecer valores iniciais (que partem de R$150).
Seja simpática, persuasiva e foque na beleza e bem-estar.`,
};

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const bucket = `demo_chat:${ip}`;
    
    // Limite da demonstração: 15 mensagens por hora por IP (para evitar uso abusivo da LLM via Sandbox)
    const limitResult = await checkRateLimit(bucket, 15, 3600);
    
    if (!limitResult.allowed) {
      return new Response("Muitas requisições. Volte mais tarde.", {
        status: 429,
      });
    }

    const { messages, niche } = await req.json();

    const systemPrompt = SYSTEM_PROMPTS[niche] || SYSTEM_PROMPTS["veiculos"];

    const result = await streamText({
      model: openai("gpt-4o-mini"),
      system: systemPrompt,
      messages,
      temperature: 0.7,
    });

    return result.toTextStreamResponse();
  } catch (err: unknown) {
    console.error("[demo-chat]", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
