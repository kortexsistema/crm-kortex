import { notFound } from "next/navigation";

import { listarCredenciaisDaPlataforma } from "@/lib/ai/credenciais/plataforma";
import { loadAuthUser } from "@/lib/auth/server";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { IaPlatformClient } from "./_client";

export const metadata = { title: "Provedores de IA da Plataforma (Admin Master)" };
export const dynamic = "force-dynamic";

/**
 * Painel exclusivo do Administrador Master para gerenciamento centralizado das
 * chaves de API dos provedores de IA (Anthropic, OpenAI, Google Gemini, OpenRouter).
 *
 * As chaves salvas aqui são criptografadas (AES-256-GCM) e disponibilizadas como
 * padrão para todos os inquilinos/organizações no modelo SaaS.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const credenciais = await listarCredenciaisDaPlataforma();
  const ambiente = lerAmbiente();

  return (
    <IaPlatformClient
      credenciaisIniciais={credenciais}
      envChaves={ambiente.chavesDeProvedor}
      idioma={usuario.idioma}
    />
  );
}
