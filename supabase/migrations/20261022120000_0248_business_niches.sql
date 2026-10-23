-- Migration 0248: Schema de nichos de negócio e governança por organização.
-- Permite especializar o comportamento do sistema por segmento de mercado (ex: ecommerce, veiculos).
-- Retrocompatibilidade total: todas as organizações existentes e novas recebem 'ecommerce' por padrão.

create table if not exists public.business_niches (
  id text primary key,
  label text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- RLS para business_niches
alter table public.business_niches enable row level security;

drop policy if exists business_niches_select on public.business_niches;
create policy business_niches_select on public.business_niches
  for select
  to authenticated
  using (active = true or public.fn_is_platform_admin());

drop policy if exists business_niches_platform_admin_write on public.business_niches;
create policy business_niches_platform_admin_write on public.business_niches
  for all
  to authenticated
  using (public.fn_is_platform_admin())
  with check (public.fn_is_platform_admin());

revoke all on public.business_niches from anon;
grant select on public.business_niches to authenticated;
grant all on public.business_niches to service_role;

-- Seed inicial idempotente dos nichos conhecidos
insert into public.business_niches (id, label, description, active)
values
  ('ecommerce', 'Comércio Eletrônico', 'Catálogo de produtos, pedidos, integração Nuvemshop e vendas online.', true),
  ('vehicles', 'Veículos & Automotivo', 'Estoque de veículos, modelos, marcas, quilometragem, preços e status comercial.', true)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  active = excluded.active;

-- Adição da coluna niche_id na tabela organizations com default seguro
alter table public.organizations
  add column if not exists niche_id text not null default 'ecommerce'
  references public.business_niches(id);

create index if not exists idx_organizations_niche_id
  on public.organizations(niche_id);
