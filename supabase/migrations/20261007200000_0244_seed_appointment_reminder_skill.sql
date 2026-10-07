-- 20261007200000_0244_seed_appointment_reminder_skill.sql

DO $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO skill_versions (organization_id, name, description, body, matcher, manifest, created_at)
  VALUES (
    NULL,
    'appointment_reminder',
    'Lida com intenções de confirmação ou reagendamento de um compromisso quando o lead recebe um lembrete pendente.',
    '## Lembretes de Compromisso pendentes
Se o lead responder confirmando o compromisso ou pedindo para reagendar, use a ferramenta de atualizar status (ex: "atualizar_status_...") com o ID do compromisso retornado para atualizar o sistema de acordo. Nunca prometa confirmação sem chamar a ferramenta.
Se o lead pedir para reagendar, altere o status para "remarcar" e peça qual o melhor horário.',
    '{"any_keywords": ["confirmado", "confirmo", "sim", "reagendar", "remarcar", "pode ser", "ok", "outro horario", "não poderei"], "probe_keywords": []}',
    '[]',
    now()
  )
  RETURNING id INTO v_id;

  INSERT INTO skill_pointers (organization_id, name, version_id, updated_at)
  VALUES (NULL, 'appointment_reminder', v_id, now())
  ON CONFLICT (name) WHERE organization_id IS NULL 
  DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = now();
END $$;
