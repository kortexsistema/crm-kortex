-- Migration para criar a função remove_knowledge_source_from_agents
-- Útil para não quebrar versões de agentes (deixando IDs órfãos) ao excluir definitivamente uma fonte de conhecimento.
-- Respeita a imutabilidade do histórico limitando a atualização apenas ao rascunho (status = 'draft').

CREATE OR REPLACE FUNCTION remove_knowledge_source_from_agents(p_source_id uuid, p_org_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE ai_agent_versions
  SET knowledge_source_ids = array_remove(knowledge_source_ids, p_source_id)
  WHERE organization_id = p_org_id
    AND p_source_id = ANY(knowledge_source_ids)
    AND status = 'draft';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;