-- =====================================================================
-- SAVIA User Events — Schema v1 (Sprint 1.C — Telemetría base)
-- =====================================================================
-- Tabla genérica de eventos para medir D1/D7/D30 retention,
-- Sessions/week, TTFMM (Time to First Meaningful Moment).
--
-- Diseño mínimo: una tabla, captura desde cliente y servidor,
-- vistas SQL computan métricas sin pipeline.
--
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Vocabulario cerrado de eventos críticos. Si se agregan más adelante,
  -- ampliar este CHECK con CARE — los eventos viejos NO se renombran.
  event_name TEXT NOT NULL CHECK (event_name IN (
    -- Lifecycle del usuario
    'signup',                   -- primer login completado
    'onboarding_completed',     -- onboarding terminado, primer entrada a app
    'session_active',           -- abrió la app y hizo algo (no solo splash)

    -- TTFMM Nivel 2 (primeras acciones significativas)
    'first_log_meal',           -- primera vez que registra comida
    'first_log_water',          -- primera vez que registra agua
    'first_log_workout',        -- primera vez que registra entreno
    'first_coach_interaction',  -- primer mensaje al coach
    'first_pulse_opened',       -- primera vez que abrió un Pulse

    -- TTFMM Nivel 3 (momentos de valor percibido)
    'coach_memory_reference',   -- coach referenció una memoria histórica
    'pattern_insight_shown',    -- compute job mostró un pattern (Best Week, etc.)

    -- Ritualización
    'morning_pulse_opened',
    'evening_pulse_opened',
    'weekly_review_opened'
  )),

  -- Metadata opcional. Para coach_memory_reference: {note_id, kind, source}.
  -- Para first_log_*: {tool_name, payload_summary}.
  -- Mantener chico (<500 chars JSON).
  metadata JSONB DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Para queries por user (la mayoría de análisis empiezan acá)
CREATE INDEX IF NOT EXISTS idx_user_events_user_time
  ON user_events(user_id, occurred_at DESC);

-- Para queries por evento (cohort de usuarios que hicieron X)
CREATE INDEX IF NOT EXISTS idx_user_events_name_time
  ON user_events(event_name, occurred_at DESC);

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_events_select ON user_events;
CREATE POLICY user_events_select ON user_events
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- Insert solo via service_role (Edge Function track-event)
DROP POLICY IF EXISTS user_events_insert ON user_events;
CREATE POLICY user_events_insert ON user_events
  FOR INSERT WITH CHECK (false);

-- =====================================================================
-- VISTAS DE ANÁLISIS — computan métricas sin pipeline
-- =====================================================================

-- Cohort base: un row por usuario con signup_at + first_active_at
CREATE OR REPLACE VIEW v_user_cohort AS
SELECT
  u.id AS user_id,
  u.email,
  MIN(CASE WHEN ue.event_name = 'signup' THEN ue.occurred_at END) AS signup_at,
  MIN(CASE WHEN ue.event_name = 'session_active'
            AND ue.occurred_at::date > (
              SELECT MIN(occurred_at)::date
              FROM user_events
              WHERE user_id = u.id AND event_name = 'signup'
            )
       THEN ue.occurred_at END) AS first_active_post_signup_at,
  MIN(CASE WHEN ue.event_name = 'first_coach_interaction' THEN ue.occurred_at END) AS first_coach_at,
  MIN(CASE WHEN ue.event_name = 'first_log_meal' THEN ue.occurred_at END) AS first_log_meal_at,
  MIN(CASE WHEN ue.event_name = 'coach_memory_reference' THEN ue.occurred_at END) AS first_memory_ref_at
FROM auth.users u
LEFT JOIN user_events ue ON ue.user_id = u.id
GROUP BY u.id, u.email;

-- Retention D1/D7/D30: % de users con session_active en cada ventana
-- post-signup. Solo cuenta users con signup ≥ N días atrás.
CREATE OR REPLACE VIEW v_retention AS
WITH cohort AS (
  SELECT user_id, signup_at
  FROM v_user_cohort
  WHERE signup_at IS NOT NULL
)
SELECT
  COUNT(*) AS total_signups,
  COUNT(*) FILTER (WHERE signup_at < NOW() - INTERVAL '1 day') AS eligible_d1,
  COUNT(*) FILTER (
    WHERE signup_at < NOW() - INTERVAL '1 day'
      AND EXISTS (
        SELECT 1 FROM user_events ue
        WHERE ue.user_id = cohort.user_id
          AND ue.event_name = 'session_active'
          AND ue.occurred_at > cohort.signup_at + INTERVAL '20 hours'
          AND ue.occurred_at < cohort.signup_at + INTERVAL '48 hours'
      )
  ) AS d1_active,
  COUNT(*) FILTER (WHERE signup_at < NOW() - INTERVAL '7 days') AS eligible_d7,
  COUNT(*) FILTER (
    WHERE signup_at < NOW() - INTERVAL '7 days'
      AND EXISTS (
        SELECT 1 FROM user_events ue
        WHERE ue.user_id = cohort.user_id
          AND ue.event_name = 'session_active'
          AND ue.occurred_at > cohort.signup_at + INTERVAL '6 days'
          AND ue.occurred_at < cohort.signup_at + INTERVAL '8 days'
      )
  ) AS d7_active,
  COUNT(*) FILTER (WHERE signup_at < NOW() - INTERVAL '30 days') AS eligible_d30,
  COUNT(*) FILTER (
    WHERE signup_at < NOW() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1 FROM user_events ue
        WHERE ue.user_id = cohort.user_id
          AND ue.event_name = 'session_active'
          AND ue.occurred_at > cohort.signup_at + INTERVAL '29 days'
          AND ue.occurred_at < cohort.signup_at + INTERVAL '31 days'
      )
  ) AS d30_active
FROM cohort;

-- TTFMM Nivel 1: tiempo desde signup hasta primera session_active post-onboarding.
-- Target: <24h en >50% de usuarios.
CREATE OR REPLACE VIEW v_ttfmm_n1 AS
SELECT
  user_id,
  signup_at,
  first_active_post_signup_at,
  EXTRACT(EPOCH FROM (first_active_post_signup_at - signup_at)) / 3600 AS hours_to_ttfmm
FROM v_user_cohort
WHERE signup_at IS NOT NULL
  AND first_active_post_signup_at IS NOT NULL;

-- TTFMM Nivel 2: tiempo hasta primera interacción con coach
CREATE OR REPLACE VIEW v_ttfmm_n2 AS
SELECT
  user_id,
  signup_at,
  first_coach_at,
  EXTRACT(EPOCH FROM (first_coach_at - signup_at)) / 3600 AS hours_to_coach
FROM v_user_cohort
WHERE signup_at IS NOT NULL
  AND first_coach_at IS NOT NULL;

-- Sessions per week por usuario activo
CREATE OR REPLACE VIEW v_sessions_per_week AS
SELECT
  user_id,
  DATE_TRUNC('week', occurred_at) AS week,
  COUNT(*) AS sessions
FROM user_events
WHERE event_name = 'session_active'
GROUP BY user_id, DATE_TRUNC('week', occurred_at);

-- =====================================================================
-- Verificación post-install:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'user_events';
--   SELECT viewname FROM pg_views
--   WHERE schemaname = 'public' AND viewname LIKE 'v_%';
-- Tabla = 1 row. Vistas = 5 rows.
-- =====================================================================
