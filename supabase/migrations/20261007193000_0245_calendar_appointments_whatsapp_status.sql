-- 20261007193000_0245_calendar_appointments_whatsapp_status.sql

ALTER TABLE "public"."calendar_appointments"
ADD COLUMN IF NOT EXISTS "whatsapp_reminder_status" text NOT NULL DEFAULT 'pendente';
