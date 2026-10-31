-- 0255_message_templates_admin_write — Admin e platform_admin gerenciam templates pessoais e compartilhados
--
-- MOTIVO:
-- Em /app/templates (Respostas rápidas), a policy message_templates_write permitia escrita
-- apenas ao próprio criador (para templates pessoais, owner_user_id = auth.uid()) ou
-- a manager+ exclusivamente para templates já compartilhados (owner_user_id is null).
-- Com isso:
-- 1. Administradores da organização não podiam editar nem excluir scripts pessoais de seus atendentes.
-- 2. Operadores de suporte da plataforma (platform_admin em suporte full) não podiam editar nem excluir nenhum template pessoal.
-- 3. A UI ocultava os botões de editar e excluir porque canModify verificava apenas owner_user_id === currentUserId.
--
-- CORREÇÃO:
-- 1. message_templates_select: permite leitura org-wide para admins (fn_role_at_least(admin)) e platform_admins.
-- 2. message_templates_write: permite atualização e exclusão de qualquer template da org para admins e platform_admins.

drop policy if exists "message_templates_select" on public.message_templates;
create policy "message_templates_select" on public.message_templates
  for select using (
    (
      organization_id in (select public.fn_user_org_ids())
      and (
        owner_user_id is null
        or owner_user_id = auth.uid()
        or public.fn_role_at_least(organization_id, 'admin')
      )
    )
    or public.fn_is_platform_admin()
  );

drop policy if exists "message_templates_write" on public.message_templates;
create policy "message_templates_write" on public.message_templates
  for all using (
    (
      organization_id in (select public.fn_user_org_ids())
      and (
        (owner_user_id = auth.uid() and public.fn_role_at_least(organization_id, 'agent'))
        or (owner_user_id is null and public.fn_role_at_least(organization_id, 'manager'))
        or public.fn_role_at_least(organization_id, 'admin')
      )
    )
    or public.fn_is_platform_admin()
  )
  with check (
    (
      organization_id in (select public.fn_user_org_ids())
      and (
        (owner_user_id = auth.uid() and public.fn_role_at_least(organization_id, 'agent'))
        or (owner_user_id is null and public.fn_role_at_least(organization_id, 'manager'))
        or public.fn_role_at_least(organization_id, 'admin')
      )
    )
    or public.fn_is_platform_admin()
  );

