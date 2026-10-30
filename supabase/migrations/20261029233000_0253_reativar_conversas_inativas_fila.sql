-- 0253 — Reativação de conversas inativas da fila para o atendimento automático
--
-- Restaura o atendimento automático para conversas que ficaram retidas na fila
-- (status 'pending' ou 'open' com assigned_to_user_id IS NULL) por mais de 120 minutos
-- sem interação ou em casos legados onde a IA silenciava com 'infinity'.
--
-- GARANTIAS:
-- 1. NUNCA toca em conversas assumidas por operadores humanos (assigned_to_user_id IS NOT NULL).
-- 2. Zera bot_silenced_until, last_handoff_at e last_handoff_reason das conversas sem dono humano.
-- 3. Transiciona status para 'ai_handling' e assignee_kind para 'ai'.
-- 4. Desbloqueia contacts.force_human se o contato não tiver outra conversa com operador humano.

-- 1. Reativar conversas da fila sem operador humano que estão inativas há mais de 120 minutos ou legadas
update public.conversations
   set status = 'ai_handling',
       bot_silenced_until = null,
       last_handoff_at = null,
       last_handoff_reason = null,
       assignee_kind = 'ai',
       status_changed_at = now(),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'handoff_auto_resumed_at', now(),
         'handoff_auto_resumed_reason', 'migration_0253_cleanup'
       )
 where status in ('pending', 'open')
   and assigned_to_user_id is null
   and (assignee_kind is null or assignee_kind != 'user');

-- 2. Destravar os contatos dessas conversas para que o robô possa voltar a responder
update public.contacts ct
   set force_human = false
 where ct.force_human = true
   and exists (
     select 1 from public.conversations c
      where c.contact_id = ct.id
        and c.organization_id = ct.organization_id
        and c.assigned_to_user_id is null
        and (c.assignee_kind is null or c.assignee_kind != 'user')
   )
   and not exists (
     select 1 from public.conversations c_human
      where c_human.contact_id = ct.id
        and c_human.organization_id = ct.organization_id
        and c_human.assigned_to_user_id is not null
   );
