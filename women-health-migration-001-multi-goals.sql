-- =====================================================================
-- SAVIA Women's Health — Migration 001
-- Convertir goal_primary (TEXT single) → goals (TEXT[] multi-select)
-- =====================================================================
-- Idempotente. Safe para re-run.
-- Correr en Supabase SQL Editor.
-- =====================================================================

-- 1. Agregar columna goals (multi-select)
ALTER TABLE women_health_profile
  ADD COLUMN IF NOT EXISTS goals TEXT[] DEFAULT '{}'::text[];

-- 2. Migrar data existente: goal_primary → goals[0]
UPDATE women_health_profile
  SET goals = ARRAY[goal_primary]
  WHERE goal_primary IS NOT NULL
    AND (goals IS NULL OR cardinality(goals) = 0);

-- 3. goal_primary queda como columna legacy (no la borramos para no romper
--    nada). El código nuevo escribe AMBAS: goals[] y goal_primary = goals[0].

-- =====================================================================
-- Verificación post-install:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'women_health_profile'
--     AND column_name IN ('goals','goal_primary');
-- Debe devolver 2 rows: goals (ARRAY) y goal_primary (text).
-- =====================================================================
