export interface Appointment {
  id: string;
  organizationId: string;
  source: 'native' | 'external_supabase';
  title: string;
  clientName: string;
  clientPhone: string;
  startsAt: string; // ISO 8601
  whatsappStatus: string;
  
  // Metadados específicos da origem
  sourceTable?: string;
}
