-- Migration 0250: Confirmação transacional e atômica de importação de veículos
-- Subetapa 2.6: Garante atomicidade ACID real (PostgreSQL PL/pgSQL RPC)
-- 1. Coluna idempotency_key e índice único parcial em vehicle_import_batches
-- 2. Função public.fn_confirm_vehicle_import com trava FOR UPDATE, verificação de nicho,
--    autorização (manager+), deduplicação no estoque e rollback total em caso de erro.
-- 3. Proteção rigorosa de execução: SECURITY DEFINER com search_path = public, pg_temp,
--    revogação para public, anon e authenticated, e grant exclusivo para service_role.

-- ============================================================================
-- 1. COLUNA E ÍNDICE DE IDEMPOTÊNCIA EM vehicle_import_batches
-- ============================================================================
alter table public.vehicle_import_batches
  add column if not exists idempotency_key text;

create unique index if not exists uq_vehicle_import_batches_org_idempotency
  on public.vehicle_import_batches (organization_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- 2. FUNÇÃO TRANSACIONAL DE CONFIRMAÇÃO (fn_confirm_vehicle_import)
-- ============================================================================
create or replace function public.fn_confirm_vehicle_import(
  p_org_id          uuid,
  p_batch_id        uuid,
  p_actor_id        uuid,
  p_idempotency_key text,
  p_file_hash       text,
  p_vehicles        jsonb,
  p_errors          jsonb default '[]'::jsonb
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_batch           public.vehicle_import_batches%rowtype;
  v_niche           text;
  v_is_admin        boolean;
  v_is_platform     boolean;
  v_imported_count  integer := 0;
  v_duplicate_count integer := 0;
  v_stock_dups      jsonb := '[]'::jsonb;
  v_confirmed_at    timestamptz := now();
  v_record          jsonb;
  v_chassi          text;
  v_placa_completa  text;
  v_exists          boolean;
begin
  -- 1. Validação defensiva de parâmetros obrigatórios
  if p_org_id is null or p_batch_id is null or p_actor_id is null then
    raise exception 'invalid_arguments: p_org_id, p_batch_id e p_actor_id são obrigatórios'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'invalid_arguments: idempotency_key deve ter pelo menos 8 caracteres'
      using errcode = '22023';
  end if;

  if p_vehicles is null or jsonb_typeof(p_vehicles) <> 'array' then
    raise exception 'invalid_arguments: p_vehicles deve ser um array JSON'
      using errcode = '22023';
  end if;

  -- 2. Verificação estrita de nicho da organização (fail-closed)
  select o.niche_id into v_niche
    from public.organizations o
   where o.id = p_org_id;

  if v_niche is null or v_niche <> 'vehicles' then
    raise exception 'forbidden_niche: organização não pertence ao nicho vehicles'
      using errcode = '42501';
  end if;

  -- 3. Verificação de autorização do ator (manager+ na org ou platform_admin)
  select exists(
    select 1 from public.user_organizations uo
     where uo.organization_id = p_org_id
       and uo.user_id = p_actor_id
       and uo.role in ('manager', 'admin')
       and uo.revoked_at is null
  ) into v_is_admin;

  if not v_is_admin then
    select exists(
      select 1 from public.platform_admins pa
       where pa.user_id = p_actor_id
         and pa.revoked_at is null
    ) into v_is_platform;

    if not v_is_platform then
      raise exception 'unauthorized_role: ator não possui privilégios de manager ou admin'
        using errcode = '42501';
    end if;
  end if;

  -- 4. Trava pessimista no lote de importação (FOR UPDATE)
  select * into v_batch
    from public.vehicle_import_batches
   where id = p_batch_id
     and organization_id = p_org_id
     for update;

  if not found then
    raise exception 'batch_not_found: lote não encontrado para a organização informada'
      using errcode = 'P0002';
  end if;

  -- 5. Verificação de idempotência para lote já concluído
  if v_batch.status = 'completed' then
    if (v_batch.idempotency_key is not null and v_batch.idempotency_key = p_idempotency_key)
       or (v_batch.metadata->>'idempotency_key' = p_idempotency_key) then
      return jsonb_build_object(
        'batch_id', v_batch.id,
        'status', 'completed',
        'total_rows', v_batch.total_rows,
        'imported_count', v_batch.imported_count,
        'duplicate_count', v_batch.duplicate_count,
        'error_count', v_batch.error_count,
        'confirmed_at', coalesce(v_batch.confirmed_at, v_batch.updated_at),
        'idempotency_replayed', true
      );
    else
      raise exception 'batch_already_confirmed: lote já foi confirmado com outra chave de idempotência'
        using errcode = '23505';
    end if;
  end if;

  -- 6. Verificação de status elegível para confirmação
  if v_batch.status <> 'preview' then
    raise exception 'invalid_batch_status: lote está em status incompatível para confirmação (%)', v_batch.status
      using errcode = '22023';
  end if;

  -- 7. Verificação anti-adulteração de hash do arquivo original
  if v_batch.file_hash is not null and p_file_hash is not null and v_batch.file_hash <> p_file_hash then
    raise exception 'file_hash_mismatch: hash do arquivo difere da pré-visualização'
      using errcode = '22023';
  end if;

  -- 8. Verificação se a chave de idempotência já pertence a outro lote da mesma organização
  if exists (
    select 1 from public.vehicle_import_batches
     where organization_id = p_org_id
       and id <> p_batch_id
       and (idempotency_key = p_idempotency_key or metadata->>'idempotency_key' = p_idempotency_key)
  ) then
    raise exception 'idempotency_key_already_used: chave de idempotência já utilizada em outro lote'
      using errcode = '23505';
  end if;

  -- 9. Iteração e inserção atômica com deduplicação em tempo real no banco
  for v_record in select * from jsonb_array_elements(p_vehicles)
  loop
    v_chassi := nullif(trim(v_record->>'chassi'), '');
    v_placa_completa := nullif(trim(v_record->>'placa_completa'), '');
    v_exists := false;

    if v_chassi is not null or v_placa_completa is not null then
      select exists(
        select 1 from public.vehicles v
         where v.organization_id = p_org_id
           and (
             (v_chassi is not null and upper(v.chassi) = upper(v_chassi))
             or
             (v_placa_completa is not null and upper(v.placa_completa) = upper(v_placa_completa))
           )
      ) into v_exists;
    end if;

    if v_exists then
      v_duplicate_count := v_duplicate_count + 1;
      v_stock_dups := v_stock_dups || jsonb_build_object(
        'linha', coalesce((v_record->>'linha')::integer, 0),
        'campo', 'duplicidade',
        'motivo', format('Veículo (chassi %s / placa %s) já existe no estoque da organização', coalesce(v_chassi, '-'), coalesce(v_placa_completa, '-'))
      );
    else
      -- Mapeamento estrito de colunas autorizadas (ignora campos arbitrários do cliente)
      insert into public.vehicles (
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
        placa_completa,
        chassi,
        custo_aquisicao_cents,
        custo_preparacao_cents,
        observacoes_internas
      ) values (
        p_org_id,
        p_batch_id,
        coalesce(trim(v_record->>'marca'), ''),
        coalesce(trim(v_record->>'modelo'), ''),
        nullif(trim(v_record->>'versao'), ''),
        (v_record->>'ano_fabricacao')::integer,
        (v_record->>'ano_modelo')::integer,
        nullif(trim(v_record->>'cor'), ''),
        nullif(trim(v_record->>'combustivel'), ''),
        nullif(trim(v_record->>'cambio'), ''),
        (v_record->>'quilometragem')::integer,
        (v_record->>'preco_cents')::bigint,
        coalesce(nullif(trim(v_record->>'moeda'), ''), 'BRL'),
        coalesce(nullif(trim(v_record->>'status'), ''), 'disponivel'),
        coalesce((select array_agg(x::text) from jsonb_array_elements_text(coalesce(v_record->'opcionais', '[]'::jsonb)) x), '{}'::text[]),
        coalesce((select array_agg(x::text) from jsonb_array_elements_text(coalesce(v_record->'fotos_urls', '[]'::jsonb)) x), '{}'::text[]),
        nullif(trim(v_record->>'placa_final'), ''),
        v_placa_completa,
        v_chassi,
        (v_record->>'custo_aquisicao_cents')::bigint,
        (v_record->>'custo_preparacao_cents')::bigint,
        nullif(trim(v_record->>'observacoes_internas'), '')
      );
      v_imported_count := v_imported_count + 1;
    end if;
  end loop;

  -- 10. Atualização atômica do lote de importação
  update public.vehicle_import_batches
     set status = 'completed',
         idempotency_key = p_idempotency_key,
         imported_count = v_imported_count,
         duplicate_count = v_batch.duplicate_count + v_duplicate_count,
         error_count = v_batch.error_count,
         errors = coalesce(p_errors, '[]'::jsonb) || v_stock_dups,
         confirmed_by = p_actor_id,
         confirmed_at = v_confirmed_at,
         metadata = jsonb_set(
           jsonb_set(coalesce(metadata, '{}'::jsonb), '{idempotency_key}', to_jsonb(p_idempotency_key)),
           '{completed_at}', to_jsonb(to_char(v_confirmed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         )
   where id = p_batch_id
     and organization_id = p_org_id;

  -- 11. Retorno JSON compatível com VehicleConfirmApiResponse
  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'completed',
    'total_rows', v_batch.total_rows,
    'imported_count', v_imported_count,
    'duplicate_count', v_batch.duplicate_count + v_duplicate_count,
    'error_count', v_batch.error_count,
    'confirmed_at', v_confirmed_at,
    'idempotency_replayed', false
  );
end;
$$;

comment on function public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb) is
  'Confirmação atômica e transacional de lote de importação de veículos. Executa em única transação: trava FOR UPDATE, checa autorização e nicho, deduplica e insere veículos, atualiza o lote e garante rollback total em falhas.';

-- ── OS DOIS REVOKES (CLAUDE.md, item 9) ──
revoke execute on function public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.fn_confirm_vehicle_import(uuid, uuid, uuid, text, text, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
