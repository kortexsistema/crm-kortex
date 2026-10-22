-- Migration 0247: Adiciona suporte a minutos na janela de envio de channel_knobs.
-- Permite configurar janelas com precisão de minutos (ex: 08:30 até 18:00).
-- Default 0 mantém 100% de retrocompatibilidade com janelas em horas cheias.

alter table public.channel_knobs
  add column if not exists window_start_minute smallint default 0,
  add column if not exists window_end_minute smallint default 0;

alter table public.channel_knobs
  drop constraint if exists channel_knobs_window_minutes_range;

alter table public.channel_knobs
  add constraint channel_knobs_window_minutes_range
  check (
    (window_start_minute is null or (window_start_minute >= 0 and window_start_minute <= 59))
    and
    (window_end_minute is null or (window_end_minute >= 0 and window_end_minute <= 59))
  );
