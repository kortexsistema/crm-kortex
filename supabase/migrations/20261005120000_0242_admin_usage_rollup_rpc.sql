-- 20261005120000_0242_admin_usage_rollup_rpc.sql

-- Função para contagem agregada por tenant
CREATE OR REPLACE FUNCTION fn_admin_usage_tenant_aggregates(p_days int, p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  organization_id uuid,
  messages_count bigint,
  conversations_count bigint,
  ai_invocations_count bigint,
  ai_tokens_total bigint,
  ai_cost_cents numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
BEGIN
  v_start := now() - (p_days || ' days')::interval;

  RETURN QUERY
  WITH orgs AS (
    SELECT id
    FROM organizations
    WHERE (p_tenant_id IS NULL OR id = p_tenant_id)
  ),
  mc AS (
    SELECT m.organization_id, COUNT(*) as cnt
    FROM messages m
    WHERE m.created_at >= v_start
      AND (p_tenant_id IS NULL OR m.organization_id = p_tenant_id)
    GROUP BY m.organization_id
  ),
  cc AS (
    SELECT c.organization_id, COUNT(*) as cnt
    FROM conversations c
    WHERE c.created_at >= v_start
      AND (p_tenant_id IS NULL OR c.organization_id = p_tenant_id)
    GROUP BY c.organization_id
  ),
  ai AS (
    SELECT 
      l.organization_id, 
      COUNT(*) as invocations,
      SUM(COALESCE(l.input_tokens, 0) + COALESCE(l.output_tokens, 0)) as tokens,
      SUM(COALESCE(l.cost_cents, 0)) as cost
    FROM llm_calls l
    WHERE l.created_at >= v_start
      AND (p_tenant_id IS NULL OR l.organization_id = p_tenant_id)
    GROUP BY l.organization_id
  )
  SELECT 
    o.id as organization_id,
    COALESCE(mc.cnt, 0) as messages_count,
    COALESCE(cc.cnt, 0) as conversations_count,
    COALESCE(ai.invocations, 0) as ai_invocations_count,
    COALESCE(ai.tokens, 0) as ai_tokens_total,
    COALESCE(ai.cost, 0) as ai_cost_cents
  FROM orgs o
  LEFT JOIN mc ON mc.organization_id = o.id
  LEFT JOIN cc ON cc.organization_id = o.id
  LEFT JOIN ai ON ai.organization_id = o.id;
END;
$$;

-- Função para série temporal diária
CREATE OR REPLACE FUNCTION fn_admin_usage_daily_series(p_days int, p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  date_label text,
  messages_count bigint,
  ai_tokens_total bigint,
  ai_cost_cents numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
BEGIN
  v_start := now() - (p_days || ' days')::interval;

  RETURN QUERY
  WITH dates AS (
    SELECT to_char(d, 'YYYY-MM-DD') as dt
    FROM generate_series(now() - ((p_days - 1) || ' days')::interval, now(), '1 day'::interval) d
  ),
  mc AS (
    SELECT to_char(m.created_at, 'YYYY-MM-DD') as dt, COUNT(*) as cnt
    FROM messages m
    WHERE m.created_at >= v_start
      AND (p_tenant_id IS NULL OR m.organization_id = p_tenant_id)
    GROUP BY to_char(m.created_at, 'YYYY-MM-DD')
  ),
  ai AS (
    SELECT 
      to_char(l.created_at, 'YYYY-MM-DD') as dt,
      SUM(COALESCE(l.input_tokens, 0) + COALESCE(l.output_tokens, 0)) as tokens,
      SUM(COALESCE(l.cost_cents, 0)) as cost
    FROM llm_calls l
    WHERE l.created_at >= v_start
      AND (p_tenant_id IS NULL OR l.organization_id = p_tenant_id)
    GROUP BY to_char(l.created_at, 'YYYY-MM-DD')
  )
  SELECT 
    d.dt as date_label,
    COALESCE(mc.cnt, 0) as messages_count,
    COALESCE(ai.tokens, 0) as ai_tokens_total,
    COALESCE(ai.cost, 0) as ai_cost_cents
  FROM dates d
  LEFT JOIN mc ON mc.dt = d.dt
  LEFT JOIN ai ON ai.dt = d.dt
  ORDER BY d.dt ASC;
END;
$$;

-- Revogar EXECUTE de acordo com as regras de governança (CLAUDE.md)
REVOKE EXECUTE ON FUNCTION fn_admin_usage_tenant_aggregates(int, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_admin_usage_daily_series(int, uuid) FROM public, anon, authenticated;

-- Garantir EXECUTE apenas a service_role (usado pelo painel admin)
GRANT EXECUTE ON FUNCTION fn_admin_usage_tenant_aggregates(int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fn_admin_usage_daily_series(int, uuid) TO service_role;
