-- =============================================================================
-- Migration 0232: Gestão manual de assinaturas, planos e expiração SaaS
-- =============================================================================
-- Adiciona colunas nativas de assinatura na tabela organizations:
--  - subscription_expires_at timestamptz (nullable = vitalício/indefinido)
--  - plan text (standard, pro, enterprise)
-- =============================================================================

alter table public.organizations
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists plan text not null default 'standard'
    check (plan in ('standard', 'pro', 'enterprise'));

-- Backfill do plano a partir do settings legado
update public.organizations
  set plan = coalesce(nullif(settings->>'plan', ''), 'standard')
  where plan = 'standard' and settings->>'plan' is not null;

-- Índice para busca rápida de tenants ativos com expiração (usado pelo cron e billing)
create index if not exists idx_orgs_subscription_expires
  on public.organizations(subscription_expires_at)
  where status = 'active' and subscription_expires_at is not null;

-- Atualizar fn_create_tenant_with_owner para aceitar subscription_expires_at
create or replace function public.fn_create_tenant_with_owner(
  p_actor uuid, p_key uuid, p_request jsonb, p_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior public.idempotency_keys%rowtype;
  org public.organizations%rowtype;
  result jsonb;
  v_plan text;
  v_expires timestamptz;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor
    and revoked_at is null and scope = 'full') then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key::text, 0));
  select * into prior from public.idempotency_keys
    where key = p_key::text and endpoint = '/api/v1/admin/tenants:' || p_actor::text
      and expires_at > now();
  if found then
    if prior.request_hash <> decode(p_hash, 'hex') then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    return prior.response_body || jsonb_build_object('created', false);
  end if;

  v_plan := coalesce(nullif(p_request->>'plan', ''), 'standard');
  if v_plan not in ('standard', 'pro', 'enterprise') then
    v_plan := 'standard';
  end if;

  if p_request->>'subscription_expires_at' is not null and p_request->>'subscription_expires_at' <> '' then
    v_expires := (p_request->>'subscription_expires_at')::timestamptz;
  else
    v_expires := null;
  end if;

  insert into public.organizations(
    display_name, slug, legal_name, cnpj, status, plan, subscription_expires_at, settings, created_by
  ) values (
    p_request->>'display_name',
    p_request->>'slug',
    coalesce(nullif(p_request->>'legal_name', ''), p_request->>'display_name'),
    p_request->>'cnpj',
    'active',
    v_plan,
    v_expires,
    jsonb_build_object('plan', v_plan),
    p_actor
  ) returning * into org;

  insert into public.user_organizations(organization_id, user_id, role, accepted_at)
    values (org.id, p_actor, 'admin', now());

  result := jsonb_build_object(
    'id', org.id,
    'slug', org.slug,
    'display_name', org.display_name,
    'plan', org.plan,
    'subscription_expires_at', org.subscription_expires_at,
    'invite_id', gen_random_uuid(),
    'issued_at', floor(extract(epoch from now()))::bigint
  );

  insert into public.idempotency_keys(organization_id, key, endpoint, request_hash, status_code, response_body)
    values (org.id, p_key::text, '/api/v1/admin/tenants:' || p_actor::text,
      decode(p_hash, 'hex'), 201, result);

  return result || jsonb_build_object('created', true);
end $$;

revoke all on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text) to service_role;
