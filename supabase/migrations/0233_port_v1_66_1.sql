-- ═══ Atraso humano (0499) e Debounce (0498) ═══

alter table public.channel_knobs
  add column if not exists atraso_notar_ms integer,
  add column if not exists ms_por_caractere integer,
  add column if not exists atraso_minimo_ms integer,
  add column if not exists atraso_maximo_ms integer;

alter table public.channel_knobs
  drop constraint if exists channel_knobs_atraso_humano_saneamento;

alter table public.channel_knobs
  add constraint channel_knobs_atraso_humano_saneamento
  check (
    (atraso_notar_ms   is null or (atraso_notar_ms   between 0 and 600000))
    and (ms_por_caractere is null or (ms_por_caractere between 0 and 1000))
    and (atraso_minimo_ms is null or (atraso_minimo_ms between 0 and 600000))
    and (atraso_maximo_ms is null or (atraso_maximo_ms between 0 and 600000))
    and (atraso_maximo_ms is null or atraso_minimo_ms is null or atraso_maximo_ms >= atraso_minimo_ms)
  );

alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_inbound_debounce_ms_check;

alter table public.ai_agent_versions
  add column if not exists inbound_debounce_ms integer;

alter table public.ai_agent_versions
  add constraint ai_agent_versions_inbound_debounce_ms_check
  check (inbound_debounce_ms is null or (inbound_debounce_ms >= 0 and inbound_debounce_ms <= 60000));
