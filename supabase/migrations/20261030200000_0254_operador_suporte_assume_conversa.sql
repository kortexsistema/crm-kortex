-- 0254_operador_suporte_assume_conversa — Operador de suporte ('full') pode assumir conversas
--
-- MOTIVO:
-- Ao navegar em modo de suporte com Edição permitida (access_mode = 'full'),
-- clicar em "Assumir" invocava fn_conversation_assign com p_to_user_id = actor_user_id.
-- A função validava se p_to_user_id pertencia à organização via fn_member_role_in_org.
-- Como sessões de suporte temporário propositalmente não criam membership em
-- user_organizations (migration 0220), a verificação falhava com a exceção
-- 'assignee_not_eligible_member', retornando erro 500 no endpoint de claim.
-- Além disso, fn_member_role_in_org exigia que o chamador (auth.uid()) estivesse
-- em user_organizations, o que impedia até transferências para outros membros.
--
-- CORREÇÃO:
-- 1. fn_member_role_in_org: autoriza chamadores que sejam platform_admin ou que possuam
--    sessão de suporte ativa na organização a consultar papéis de membros.
-- 2. fn_conversation_assign: permite que o operador em suporte com permissão de escrita
--    (fn_support_write_allowed AND fn_role_at_least(agent)) seja elegível para assumir a
--    conversa diretamente (p_to_user_id = auth.uid()).

-- 1. Helper fn_member_role_in_org atualizado com guard de suporte e platform admin
create or replace function public.fn_member_role_in_org(p_user uuid, p_org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select uo.role
    from public.user_organizations uo
   where uo.user_id = p_user
     and uo.organization_id = p_org
     and uo.revoked_at is null
     and (
       auth.uid() is null
       or public.fn_is_platform_admin()
       or exists (
         select 1 from (select public.fn_support_context() s) c
          where (s->>'status') = 'active'
            and (s->>'organization_id')::uuid = p_org
       )
       or exists (
         select 1 from public.user_organizations me
          where me.user_id = auth.uid()
            and me.organization_id = p_org
            and me.revoked_at is null
       )
     )
   limit 1;
$$;

revoke all on function public.fn_member_role_in_org(uuid, uuid) from public;
revoke execute on function public.fn_member_role_in_org(uuid, uuid) from anon;
grant execute on function public.fn_member_role_in_org(uuid, uuid) to authenticated, service_role;

-- 2. fn_conversation_assign com suporte a atribuição de operador de suporte ativo
CREATE OR REPLACE FUNCTION public.fn_conversation_assign(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_user_id uuid,
  p_reason text,
  p_expected_assignee uuid DEFAULT NULL::uuid,
  p_enforce_expected boolean DEFAULT false
)
 RETURNS SETOF conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from uuid;
  v_conv public.conversations%rowtype;
begin
  if not public.fn_support_write_allowed(p_organization_id) then
    raise exception 'support_readonly' using errcode='42501';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'caller must be an active agent+ member of the organization';
  end if;

  if p_to_user_id is not null then
    if coalesce(public.fn_member_role_in_org(p_to_user_id, p_organization_id), 'none')
         not in ('agent','manager','admin')
       and not (
         p_to_user_id = auth.uid()
         and public.fn_support_write_allowed(p_organization_id)
         and public.fn_role_at_least(p_organization_id, 'agent')
       ) then
      raise exception 'assignee_not_eligible_member'
        using hint = 'target must be an active agent+ member of the organization';
    end if;
  end if;

  select assigned_to_user_id into v_from
    from public.conversations
   where id = p_conversation_id
     and organization_id = p_organization_id
   for no key update;

  if not found then
    return;
  end if;

  if p_enforce_expected and v_from is distinct from p_expected_assignee then
    return;
  end if;

  update public.conversations
     set assigned_to_user_id = p_to_user_id,
         assigned_to_user_name = case
           when p_to_user_id is null then null
           else (select raw_user_meta_data ->> 'full_name' from auth.users where id = p_to_user_id)
         end,
         assigned_at = case when p_to_user_id is null then null else now() end,
         assignee_kind = case when p_to_user_id is null then null else 'user' end,
         status = case when p_to_user_id is null then 'open' else 'claimed' end,
         status_changed_at = now(),
         unread_count_for_assignee = 0,
         bot_silenced_until = case
           when p_reason = 'routing'  then bot_silenced_until
           when p_to_user_id is null  then (case when last_handoff_at is null
                                                 then null
                                                 else bot_silenced_until end)
           else 'infinity'::timestamptz
         end,
         updated_at = now()
   where id = p_conversation_id
   returning * into v_conv;

  insert into public.conversation_assignment_events
    (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
  values
    (p_organization_id, p_conversation_id, v_from, p_to_user_id, auth.uid(), p_reason);

  return next v_conv;
end;
$function$;

revoke all     on function public.fn_conversation_assign(uuid, uuid, uuid, text, uuid, boolean) from public;
revoke execute on function public.fn_conversation_assign(uuid, uuid, uuid, text, uuid, boolean) from anon;
grant  execute on function public.fn_conversation_assign(uuid, uuid, uuid, text, uuid, boolean)
  to authenticated, service_role;

