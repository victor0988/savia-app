-- =====================================================================
-- SAVIA Pulse — Schema v1
-- =====================================================================
-- Hero insight card que reemplaza el AI Insight estático.
-- 1 tabla: savia_pulses (cada insight generado vive ahí).
-- RLS + indexes. Tracking timestamps explícitos (dismissed_at,
-- shown_in_chat_at) en lugar de un updated_at genérico.
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS savia_pulses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ─── Contenido del insight ────────────────────────────────────────
  category TEXT NOT NULL CHECK (category IN (
    'recovery',       -- HRV + sleep + nutrición (mañana o post-night)
    'nutrition',      -- balance acumulado vs plan + frecuentes
    'training_prep',  -- pre-entreno: recovery + nutrición + workout del día
    'post_workout',   -- ventana proteína + ganancia kcal
    'behavioral',     -- adherencia + rachas + patrones semanales
    'body_comp',      -- InBody nuevo o tendencia peso/masa magra
    'hormonal'        -- solo Women's Health activado: fase + energía
  )),

  -- Narrativa del insight (mostrada en la card). Cap de 280 chars — la UI
  -- está diseñada para 2-3 líneas.
  headline TEXT NOT NULL
    CHECK (char_length(headline) BETWEEN 1 AND 280),

  -- Mensaje que el coach usará si el usuario tap → chat
  -- (Le da contexto al modelo para profundizar en este pulse específico).
  context_for_chat TEXT,

  -- ─── Lifecycle ────────────────────────────────────────────────────
  -- expires_at: cuándo este insight queda "viejo" y se debería regenerar.
  -- Default 4h (safety net). La Edge Function lo override según categoría.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours'),

  -- dismissed: el user lo descartó (swipe / X). No se muestra más.
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,

  -- shown_in_chat: si el user ya hizo tap y abrió chat con este pulse.
  -- Útil para no repetir el mismo insight si volvió a Hoy.
  shown_in_chat BOOLEAN NOT NULL DEFAULT FALSE,
  shown_in_chat_at TIMESTAMPTZ,

  -- thread_id: si el user inició conversación desde este pulse, qué thread.
  -- Soft reference (no FK) porque coach_threads puede archivarse.
  thread_id UUID,

  -- ─── Debug / observability ────────────────────────────────────────
  -- triggering_data: snapshot de la data que llevó a este insight.
  -- Útil para entender por qué el generator eligió esta categoría
  -- + qué números cruzó. JSON libre.
  triggering_data JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(triggering_data) = 'object'),

  -- Modelo + tokens (cost tracking)
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Para obtener el último pulse activo del user en cada render del Hoy
CREATE INDEX IF NOT EXISTS idx_savia_pulses_user_active
  ON savia_pulses(user_id, created_at DESC)
  WHERE dismissed = false;

-- Para no repetir categoría reciente (selector chequea últimas N pulses)
CREATE INDEX IF NOT EXISTS idx_savia_pulses_user_category_time
  ON savia_pulses(user_id, category, created_at DESC);

-- Para limpieza de pulses viejos (cron futuro)
CREATE INDEX IF NOT EXISTS idx_savia_pulses_expires
  ON savia_pulses(expires_at)
  WHERE dismissed = false;

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE savia_pulses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS savia_pulses_select ON savia_pulses;
CREATE POLICY savia_pulses_select ON savia_pulses
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- Insert solo via service_role (Edge Function). Cliente NO inserta directo.
DROP POLICY IF EXISTS savia_pulses_insert ON savia_pulses;
CREATE POLICY savia_pulses_insert ON savia_pulses
  FOR INSERT WITH CHECK (false);

-- Update permite al user marcar dismissed / shown_in_chat / thread_id.
-- WITH CHECK previene que el user re-asigne el row a otro user_id.
DROP POLICY IF EXISTS savia_pulses_update ON savia_pulses;
CREATE POLICY savia_pulses_update ON savia_pulses
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
            WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS savia_pulses_delete ON savia_pulses;
CREATE POLICY savia_pulses_delete ON savia_pulses
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- =====================================================================
-- Verificación post-install:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'savia_pulses';
-- Debe devolver 1 row.
-- =====================================================================
