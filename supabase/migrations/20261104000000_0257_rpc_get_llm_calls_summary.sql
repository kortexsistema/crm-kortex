-- 0257_rpc_get_llm_calls_summary.sql
-- RPC: totaliza custos de IA por tenant, independente de max_rows da Data API
-- -------------------------------------------------------------
-- Segurança:
--   * SECURITY DEFINER
--   * search_path = pg_catalog, public   (caminho seguro)
--   * acesso somente ao service_role
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_llm_calls_summary(
    p_organization_id UUID,
    p_from           TIMESTAMPTZ,
    p_to             TIMESTAMPTZ
) RETURNS TABLE (
    total_calls        BIGINT,
    known_cost_calls   BIGINT,
    unknown_cost_calls BIGINT,
    total_cost_cents   BIGINT
) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)                                            AS total_calls,
        COUNT(*) FILTER (WHERE cost_cents IS NOT NULL)       AS known_cost_calls,
        COUNT(*) FILTER (WHERE cost_cents IS NULL)           AS unknown_cost_calls,
        COALESCE(SUM(cost_cents), 0)                         AS total_cost_cents
    FROM public.llm_calls
    WHERE organization_id = p_organization_id
      AND created_at >= p_from
      AND created_at <= p_to;
END;
$$;

-- Segurança da função
REVOKE EXECUTE ON FUNCTION public.rpc_get_llm_calls_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_llm_calls_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;

