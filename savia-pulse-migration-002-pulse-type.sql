-- =====================================================================
-- SAVIA Pulse — Migration 002 (Sprint 2.A — Morning/Evening Pulse types)
-- =====================================================================
-- Agrega pulse_type a savia_pulses para distinguir morning/evening/weekly
-- del daily pulse existente. Los pulses ya en producción quedan como 'daily'.
--
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

ALTER TABLE savia_pulses
  ADD COLUMN IF NOT EXISTS pulse_type TEXT NOT NULL DEFAULT 'daily'
    CHECK (pulse_type IN ('daily', 'morning', 'evening', 'weekly'));

-- Index para queries del client que filtran por type + freshness
CREATE INDEX IF NOT EXISTS idx_savia_pulses_user_type_active
  ON savia_pulses(user_id, pulse_type, created_at DESC)
  WHERE dismissed = false;

-- =====================================================================
-- Verificación:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'savia_pulses' AND column_name = 'pulse_type';
-- Debe devolver 1 row con default 'daily'.
-- =====================================================================
