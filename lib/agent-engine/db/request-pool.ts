/**
 * Pool do Postgres do agent-engine, sob demanda no processo Next.js (rotas
 * `/api/v1`). Sem pool global no import — mesma disciplina de
 * `workers/media-derive-worker.ts` (derivePool). SUPABASE_DB_URL ausente
 * lança na hora do request (rota converte pra 503), não na importação do
 * módulo.
 */
import type pg from 'pg';

import { createPool } from './pool';

const globalForPg = globalThis as unknown as { _requestPool: pg.Pool | null };

export function getRequestPool(): pg.Pool {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL ausente — rascunho da IA indisponível');
  
  if (!globalForPg._requestPool) {
    globalForPg._requestPool = createPool(url);
  }
  return globalForPg._requestPool;
}
