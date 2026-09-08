import type { ReactNode } from "react";
import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";

/**
 * Layout raiz de /admin — Blindagem Absoluta do Painel Master da Plataforma.
 *
 * Restrição de Acesso:
 * O painel /admin é exclusivo para superusuários globais (platform_admins).
 * Usuários com perfil comum ou administradores locais de organizações/tenants (admin local)
 * NUNCA devem ter acesso a este painel.
 *
 * Validação de Segurança:
 * Valida obrigatoriamente se o usuário autenticado pertence à tabela global platform_admins.
 * Caso tente acessar qualquer rota sob /admin, é barrado e redirecionado para /admin/forbidden (403).
 * A rota /admin/forbidden é preservada como exceção para renderizar a mensagem de acesso negado.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";

  if (pathname && !pathname.startsWith("/admin/forbidden")) {
    await requirePlatformAdmin();
  }

  return <>{children}</>;
}

