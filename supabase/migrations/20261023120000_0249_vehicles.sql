-- Migration 0249: Schema de veículos e lotes de importação (módulo automotivo).
-- Cria tabelas public.vehicle_import_batches e public.vehicles, isoladas por organização
-- e restritas ao nicho 'vehicles'.
-- Preserva catalog_products e orders (e-commerce permanece 100% intacto).
-- Campos confidenciais (chassi, placa_completa, custo_aquisicao_cents, custo_preparacao_cents,
-- observacoes_internas) são protegidos via grant por coluna e view segura public.vehicles_safe
-- com security_invoker = true.

-- ============================================================================
-- 1. TABELA DE LOTES DE IMPORTAÇÃO (vehicle_import_batches)
-- ============================================================================
create table if not exists public.vehicle_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  filename text not null,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  file_hash text,

  total_rows integer not null default 0 check (total_rows >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),

  status text not null default 'preview' check (status in ('preview', 'completed', 'failed', 'rolled_back')),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),

  created_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_import_batches_org_created
  on public.vehicle_import_batches (organization_id, created_at desc);

create index if not exists idx_vehicle_import_batches_org_status
  on public.vehicle_import_batches (organization_id, status);

drop trigger if exists trg_vehicle_import_batches_updated_at on public.vehicle_import_batches;
create trigger trg_vehicle_import_batches_updated_at
  before update on public.vehicle_import_batches
  for each row execute function public.fn_set_updated_at();

alter table public.vehicle_import_batches enable row level security;

drop policy if exists vehicle_import_batches_select on public.vehicle_import_batches;
create policy vehicle_import_batches_select on public.vehicle_import_batches
  for select
  to authenticated
  using (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicle_import_batches.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  );

drop policy if exists vehicle_import_batches_write on public.vehicle_import_batches;
create policy vehicle_import_batches_write on public.vehicle_import_batches
  for all
  to authenticated
  using (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and public.fn_role_at_least(organization_id, 'manager')
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicle_import_batches.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  )
  with check (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and public.fn_role_at_least(organization_id, 'manager')
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicle_import_batches.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  );

revoke all on public.vehicle_import_batches from anon;
grant select, insert, update on public.vehicle_import_batches to authenticated;
grant all on public.vehicle_import_batches to service_role;


-- ============================================================================
-- 2. TABELA DE VEÍCULOS (vehicles)
-- ============================================================================
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid references public.vehicle_import_batches(id) on delete set null,

  -- Atributos comerciais principais
  marca text not null,
  modelo text not null,
  versao text,
  ano_fabricacao integer check (ano_fabricacao is null or (ano_fabricacao >= 1900 and ano_fabricacao <= 2100)),
  ano_modelo integer check (ano_modelo is null or (ano_modelo >= 1900 and ano_modelo <= 2100)),
  cor text,
  combustivel text check (combustivel is null or combustivel in ('flex', 'gasolina', 'diesel', 'etanol', 'eletrico', 'hibrido', 'gnv', 'outro')),
  cambio text check (cambio is null or cambio in ('manual', 'automatico', 'automatizado', 'cvt', 'outro')),

  -- Preço e quilometragem: NULL quando ausentes (NUNCA default 0)
  quilometragem integer check (quilometragem is null or quilometragem >= 0),
  preco_cents bigint check (preco_cents is null or preco_cents >= 0),
  moeda text not null default 'BRL' check (moeda ~ '^[A-Z]{3}$'),

  -- Status comercial
  status text not null default 'disponivel' check (status in ('disponivel', 'reservado', 'vendido', 'em_preparacao')),

  -- Opcionais e fotos
  opcionais text[] not null default '{}',
  fotos_urls text[] not null default '{}',
  placa_final text check (placa_final is null or placa_final ~ '^[0-9A-Za-z]$'),

  -- Campos confidenciais internos (protegidos via grant por coluna e view segura)
  placa_completa text,
  chassi text,
  custo_aquisicao_cents bigint check (custo_aquisicao_cents is null or custo_aquisicao_cents >= 0),
  custo_preparacao_cents bigint check (custo_preparacao_cents is null or custo_preparacao_cents >= 0),
  observacoes_internas text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices otimizados para busca comercial sem bloat
create index if not exists idx_vehicles_org_status
  on public.vehicles (organization_id, status);

create index if not exists idx_vehicles_org_marca_modelo
  on public.vehicles (organization_id, lower(marca), lower(modelo));

create index if not exists idx_vehicles_org_preco
  on public.vehicles (organization_id, preco_cents)
  where preco_cents is not null;

create index if not exists idx_vehicles_org_ano
  on public.vehicles (organization_id, ano_modelo)
  where ano_modelo is not null;

create index if not exists idx_vehicles_batch_id
  on public.vehicles (import_batch_id)
  where import_batch_id is not null;

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at
  before update on public.vehicles
  for each row execute function public.fn_set_updated_at();

alter table public.vehicles enable row level security;

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select
  to authenticated
  using (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicles.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  );

drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles
  for all
  to authenticated
  using (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and public.fn_role_at_least(organization_id, 'manager')
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicles.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  )
  with check (
    public.fn_is_platform_admin()
    or (
      (organization_id in (select public.fn_user_org_ids()))
      and public.fn_role_at_least(organization_id, 'manager')
      and exists (
        select 1 from public.organizations o
        where o.id = public.vehicles.organization_id
          and o.niche_id = 'vehicles'
      )
    )
  );


-- ============================================================================
-- 3. VIEW SEGURA PARA DADOS COMERCIAIS (vehicles_safe)
-- ============================================================================
-- Projeta exclusivamente colunas comerciais e operacionais públicas.
-- Oculta dados confidenciais: placa_completa, chassi, custo_aquisicao_cents,
-- custo_preparacao_cents e observacoes_internas.
-- security_invoker = true garante que as políticas RLS da tabela base vehicles se aplicam.
create or replace view public.vehicles_safe
  with (security_invoker = true) as
select
  id,
  organization_id,
  import_batch_id,
  marca,
  modelo,
  versao,
  ano_fabricacao,
  ano_modelo,
  cor,
  combustivel,
  cambio,
  quilometragem,
  preco_cents,
  moeda,
  status,
  opcionais,
  fotos_urls,
  placa_final,
  created_at,
  updated_at
from public.vehicles;


-- ============================================================================
-- 4. PRIVILÉGIOS E PROTEÇÃO DE COLUNAS CONFIDENCIAIS
-- ============================================================================
-- 1. Revoga todos os privilégios na tabela base de anon e authenticated
revoke all on public.vehicles from anon, authenticated;

-- 2. Concede SELECT para authenticated APENAS nas colunas não-confidenciais
grant select (
  id,
  organization_id,
  import_batch_id,
  marca,
  modelo,
  versao,
  ano_fabricacao,
  ano_modelo,
  cor,
  combustivel,
  cambio,
  quilometragem,
  preco_cents,
  moeda,
  status,
  opcionais,
  fotos_urls,
  placa_final,
  created_at,
  updated_at
) on public.vehicles to authenticated;

-- 3. Permite escrita para authenticated (gerenciada via RLS vehicles_write que exige manager+)
grant insert, update, delete on public.vehicles to authenticated;

-- 4. Concede acesso irrestrito na tabela base para service_role (backend, admin e MCP autorizados)
grant all on public.vehicles to service_role;

-- 5. Privilégios na view segura
revoke all on public.vehicles_safe from anon;
grant select on public.vehicles_safe to authenticated;
grant all on public.vehicles_safe to service_role;

-- Comentários descritivos
comment on table public.vehicles is
  'Estoque e catálogo de veículos do nicho automotivo. Contém campos comerciais e campos confidenciais internos.';
comment on view public.vehicles_safe is
  'View segura de veículos para consulta comercial e operacional sem expor colunas confidenciais (chassi, placa completa, custos). Security invoker preserva RLS da tabela base.';
comment on table public.vehicle_import_batches is
  'Lotes de importação de estoque de veículos (planilhas XLSX/CSV). Guarda estado do processamento, totais, erros e auditoria do lote.';

notify pgrst, 'reload schema';
