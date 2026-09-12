import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

import { letraDoIcone } from "@/lib/branding/icone";
import { marcaDaSaida } from "@/lib/branding/saida";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sizeParam = searchParams.get("size");
  const size = sizeParam === "512" ? 512 : 192; // Fallback to 192

  const marca = await marcaDaSaida(null);
  const letra = letraDoIcone(marca.nome);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: marca.accent,
          color: marca.accentFg,
          fontSize: Math.round(size * 0.62),
          borderRadius: 0,
        }}
      >
        {letra ?? ""}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=600",
      },
    },
  );
}
