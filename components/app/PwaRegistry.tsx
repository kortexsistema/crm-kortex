"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

export function PwaRegistry() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          logger.info("[pwa.registry] Service Worker registrado", { scope: registration.scope });
        })
        .catch((err) => {
          logger.warn("[pwa.registry] Falha ao registrar Service Worker", { 
            error: err instanceof Error ? err.message : String(err) 
          });
        });
    }
  }, []);

  return null;
}
