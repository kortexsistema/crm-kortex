import type pg from "pg";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "./types";
import { logger } from "@/lib/logger";

/**
 * Unified Appointment Provider
 * Interage de forma transparente com agendamentos nativos (Kortex)
 * e externos (Supabase via integração).
 */
export class UnifiedAppointmentProvider {
  constructor(private pool: pg.Pool) {}

  /**
   * Busca compromissos pendentes de lembrete em todas as organizações e origens.
   * Filtro: `starts_at` < now + 24h e whatsapp_status != 'enviado'/'remarcar'/'confirmado'
   */
  async getPendingReminders(): Promise<Appointment[]> {
    const appointments: Appointment[] = [];
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 1. Fetch Organizations Settings first
    const admin = createAdminClient();
    const { data: orgs } = await admin.from("organizations").select("id, settings");
    const orgSettings = new Map<string, any>();
    
    for (const org of orgs || []) {
      const config = (org.settings as any)?.appointment_reminders || { enabled: false, hours_before: 24, custom_prompt: "" };
      orgSettings.set(org.id, config);
    }

    // 2. Fetch Native Appointments
    const { rows: nativeRows } = await this.pool.query(`
      SELECT 
        a.id, a.organization_id, a.title, a.starts_at, a.whatsapp_reminder_status,
        c.name as contact_name, c.phone_number
      FROM calendar_appointments a
      LEFT JOIN contacts c ON a.contact_id = c.id
      WHERE a.whatsapp_reminder_status = 'pendente'
    `);

    for (const r of nativeRows) {
      if (!r.phone_number) continue;
      const config = orgSettings.get(r.organization_id);
      if (!config || !config.enabled) continue;
      
      const inXh = new Date(now.getTime() + (config.hours_before || 24) * 60 * 60 * 1000);
      if (r.starts_at <= now || r.starts_at > inXh) continue;

      appointments.push({
        id: r.id,
        organizationId: r.organization_id,
        source: 'native',
        title: r.title,
        clientName: r.contact_name || 'Cliente',
        clientPhone: r.phone_number,
        startsAt: r.starts_at.toISOString(),
        whatsappStatus: r.whatsapp_reminder_status,
        customPrompt: config.custom_prompt
      });
    }

    // 3. Fetch External Supabase Appointments
    const { data: mappings } = await admin
      .from("supabase_integration_tables")
      .select("*, integration:tenant_integrations(store_metadata, oauth_access_token_encrypted)")
      .not("status_mapping", "eq", "{}");

    for (const mapping of mappings || []) {
      try {
        const { status_mapping, table_name, organization_id } = mapping;
        const integration = mapping.integration;
        if (!integration || Array.isArray(integration)) continue;
        
        const mappingConfig = status_mapping as Record<string, string>;
        const { date_column, status_column, phone_column, name_column, sent_value, confirmed_value } = mappingConfig;
        if (!date_column || !status_column || !phone_column || !sent_value) continue;

        const url = (integration.store_metadata as Record<string, unknown>)?.supabase_url as string | undefined;
        if (!url) continue;

        const { data: decrypted } = await admin.rpc("fn_decrypt_oauth", {
          ciphertext: integration.oauth_access_token_encrypted,
        });
        if (!decrypted) continue;

        const config = orgSettings.get(organization_id);
        if (!config || !config.enabled) continue;
        const orgInXh = new Date(now.getTime() + (config.hours_before || 24) * 60 * 60 * 1000);

        const selectParam = encodeURIComponent(`${date_column},${status_column},${phone_column}${name_column ? ',' + name_column : ''},id`);
        const filterDate = encodeURIComponent(`lt.${orgInXh.toISOString()}`);
        const filterDateGte = encodeURIComponent(`gte.${now.toISOString()}`);
        const filterStatus = encodeURIComponent(`neq.${sent_value}`);
        
        const fetchUrl = `${url.replace(/\/$/, "")}/rest/v1/${table_name}?select=${selectParam}&${date_column}=${filterDate}&${date_column}=${filterDateGte}&${status_column}=${filterStatus}&limit=50`;
        
        const response = await fetch(fetchUrl, {
          headers: { "apikey": decrypted, "Authorization": `Bearer ${decrypted}` }
        });
        
        if (!response.ok) continue;
        const appts = await response.json();

        for (const appt of appts) {
          if (appt[status_column] === sent_value || appt[status_column] === confirmed_value) continue;
          if (!appt[phone_column]) continue;

          appointments.push({
            id: String(appt.id),
            organizationId: organization_id,
            source: 'external_supabase',
            title: 'Lembrete de Compromisso',
            clientName: name_column ? String(appt[name_column]) : 'Cliente',
            clientPhone: String(appt[phone_column]),
            startsAt: new Date(appt[date_column]).toISOString(),
            whatsappStatus: String(appt[status_column]),
            customPrompt: config.custom_prompt,
            sourceTable: table_name
          });
        }
      } catch (err) {
        logger.warn(`Erro ao buscar compromissos externos para org ${mapping.organization_id}: ${err}`);
      }
    }

    return appointments;
  }

  /**
   * Atualiza o status de um compromisso apenas com o ID, deduzindo a origem.
   */
  async updateAppointmentStatus(id: string, newStatus: string): Promise<boolean> {
    // Tenta atualizar no banco nativo primeiro
    const { rowCount } = await this.pool.query(
      `UPDATE calendar_appointments SET whatsapp_reminder_status = $1 WHERE id = $2 RETURNING id`,
      [newStatus, id]
    );

    if (rowCount !== null && rowCount > 0) {
      return true; // Era nativo e foi atualizado
    }

    // Se não encontrou, é externo. Busca os mapeamentos ativos para encontrar a tabela certa.
    const admin = createAdminClient();
    const { data: mappings } = await admin
      .from("supabase_integration_tables")
      .select("*, integration:tenant_integrations(store_metadata, oauth_access_token_encrypted)")
      .not("status_mapping", "eq", "{}");

    for (const mapping of mappings || []) {
      const { status_mapping, table_name } = mapping;
      const integration = mapping.integration;
      if (!integration || Array.isArray(integration)) continue;
      
      const mappingConfig = status_mapping as Record<string, string>;
      const statusCol = mappingConfig.status_column;
      const targetVal = newStatus === 'confirmado' ? mappingConfig.confirmed_value : 
                        newStatus === 'remarcar' ? mappingConfig.reschedule_value : 
                        newStatus === 'enviado' ? mappingConfig.sent_value : newStatus;
                        
      if (!statusCol || !targetVal) continue;

      const url = (integration.store_metadata as Record<string, unknown>)?.supabase_url as string | undefined;
      if (!url) continue;

      const { data: decrypted } = await admin.rpc("fn_decrypt_oauth", {
        ciphertext: integration.oauth_access_token_encrypted,
      });
      if (!decrypted) continue;

      const updateUrl = `${url.replace(/\/$/, "")}/rest/v1/${table_name}?id=eq.${id}`;
      
      try {
        const response = await fetch(updateUrl, {
          method: "PATCH",
          headers: {
            "apikey": decrypted,
            "Authorization": `Bearer ${decrypted}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation" // para verificar se algo foi alterado
          },
          body: JSON.stringify({ [statusCol]: targetVal })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (Array.isArray(result) && result.length > 0) {
            return true; // Encontrou e atualizou externamente
          }
        }
      } catch (err) {
        // Ignora e continua procurando na próxima
      }
    }

    return false; // Não encontrou em nenhuma origem
  }
}
