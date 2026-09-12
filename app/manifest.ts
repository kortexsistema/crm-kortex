import type { MetadataRoute } from "next";

import { marcaDaSaida } from "@/lib/branding/saida";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const marca = await marcaDaSaida(null);
  return {
    name: marca.nome,
    short_name: marca.nome,
    description: `Plataforma de gestão ${marca.nome}`,
    display: "standalone",
    start_url: "/app",
    scope: "/",
    background_color: "#ffffff",
    theme_color: marca.accent,
    icons: [
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
  };
}
