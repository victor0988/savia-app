-- =====================================================================
-- SAVIA Women's Health OS — Schema v1
-- =====================================================================
-- 5 tablas + indexes + RLS + triggers updated_at
-- Correr COMPLETO en Supabase SQL Editor (no por partes).
-- Idempotente: usa IF NOT EXISTS donde aplica. Safe para re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABLA 1 · women_health_profile
-- Configuración del módulo por usuario. 1 row por user.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS women_health_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Status del módulo
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'cycle_natural'
    CHECK (status IN (
      'cycle_natural',     -- ciclo natural sin hormonas
      'hormonal_bc',       -- anticonceptivo hormonal
      'pregnancy',
      'postpartum',
      'perimenopause',
      'menopause',
      'skipped'            -- usuaria opted out
    )),

  -- Onboarding data
  age INTEGER CHECK (age IS NULL OR age BETWEEN 12 AND 80),
  avg_cycle_length_days INTEGER DEFAULT 28
    CHECK (avg_cycle_length_days BETWEEN 14 AND 60),
  avg_period_length_days INTEGER DEFAULT 5
    CHECK (avg_period_length_days BETWEEN 1 AND 14),
  last_period_start_date DATE,

  -- Condiciones / contexto
  conditions TEXT[] DEFAULT '{}',          -- ['PCOS','endometriosis','fibroids']
  hormone_therapy JSONB DEFAULT '{}'::jsonb, -- {testosterone: true, estradiol: false}
  goal_primary TEXT,                       -- 'know_body'|'plan_pregnancy'|'avoid_pregnancy'|'manage_symptoms'|'optimize_training'|'optimize_nutrition'

  -- Privacidad (B2B)
  share_with_clinician BOOLEAN DEFAULT FALSE,
  clinician_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ---------------------------------------------------------------------
-- TABLA 2 · cycle_logs
-- Cada ciclo menstrual registrado. Múltiples rows por user.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  cycle_number INTEGER NOT NULL,           -- 1, 2, 3... para esta usuaria
  started_at DATE NOT NULL,                -- día 1 del período
  ended_at DATE,                           -- último día del período (puede ser NULL si en curso)

  -- Predicciones (calculadas por algoritmo)
  predicted_end_date DATE,                 -- predicción fin del período
  predicted_next_start_date DATE,          -- predicción próximo período
  predicted_ovulation_date DATE,           -- predicción ovulación
  fertile_window_start DATE,
  fertile_window_end DATE,

  -- Detail
  flow_intensity_log JSONB DEFAULT '{}'::jsonb,  -- {"1":"heavy","2":"medium","3":"light"}
  cycle_length_days INTEGER,               -- calculado al cerrar ciclo
  notes TEXT,
  is_anomaly BOOLEAN DEFAULT FALSE,        -- flag si varía >7 días del baseline
  source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual','predicted','wearable')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, cycle_number)
);

-- ---------------------------------------------------------------------
-- TABLA 3 · cycle_day_logs
-- Log diario de síntomas y biomarcadores. 1 row por día por user.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_day_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES cycle_logs(id) ON DELETE SET NULL,

  log_date DATE NOT NULL,
  cycle_day INTEGER,                       -- día del ciclo (1-N)

  predicted_phase TEXT
    CHECK (predicted_phase IS NULL OR predicted_phase IN (
      'menstrual',
      'follicular_early',
      'follicular_late',
      'ovulatory',
      'luteal_early',
      'luteal_late'
    )),

  -- Tracking del día (quick log)
  flow_intensity TEXT
    CHECK (flow_intensity IS NULL OR flow_intensity IN (
      'spotting','light','medium','heavy'
    )),
  cramp_level INTEGER CHECK (cramp_level IS NULL OR cramp_level BETWEEN 0 AND 3),
  energy_level TEXT
    CHECK (energy_level IS NULL OR energy_level IN ('low','medium','high')),
  mood TEXT
    CHECK (mood IS NULL OR mood IN ('off','neutral','good')),
  cravings TEXT[] DEFAULT '{}',            -- ['sweet','salty','carb','nothing']
  symptoms_extra JSONB DEFAULT '{}'::jsonb, -- {headache:true, bloating:2, tender_breasts:1, ...}

  -- Sueño self-reported
  sleep_quality_self INTEGER CHECK (sleep_quality_self IS NULL OR sleep_quality_self BETWEEN 1 AND 5),

  -- Biomarcador
  bbt_celsius DECIMAL(4,2),                -- temperatura basal (de wearable o manual)
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, log_date)
);

-- ---------------------------------------------------------------------
-- TABLA 4 · hormonal_state_daily
-- Estimaciones del estado hormonal generadas por motor diario.
-- 1 row por día por user, generado por Edge Function cron.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hormonal_state_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES cycle_logs(id) ON DELETE SET NULL,

  date DATE NOT NULL,
  cycle_day INTEGER,
  phase TEXT,

  -- Scores estimados (0-100 relativos al baseline personal)
  e2_estimated_score DECIMAL(5,2),         -- estradiol relativo
  p4_estimated_score DECIMAL(5,2),         -- progesterona relativa
  energy_score DECIMAL(5,2),               -- 0-100 esperado
  readiness_score DECIMAL(5,2),            -- 0-100 estilo Oura

  confidence DECIMAL(3,2),                 -- 0.00-1.00
  recommendations JSONB DEFAULT '{}'::jsonb, -- {nutrition:[...], workout:[...], recovery:[...]}

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- ---------------------------------------------------------------------
-- TABLA 5 · cycle_insights
-- Patterns detectados por el motor de insights. UI los muestra como cards.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  insight_key TEXT NOT NULL,               -- 'sleep_drop_pre_period', 'cravings_luteal', etc
  title TEXT NOT NULL,
  description TEXT,
  pattern_type TEXT,                       -- 'sleep'|'energy'|'craving'|'performance'|'recovery'|'symptom'

  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confidence DECIMAL(3,2),                 -- 0.00-1.00

  user_acknowledged BOOLEAN DEFAULT FALSE,
  reminder_enabled BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,

  UNIQUE(user_id, insight_key)
);

-- =====================================================================
-- INDEXES
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_cycle_logs_user_started
  ON cycle_logs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cycle_day_logs_user_date
  ON cycle_day_logs(user_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_cycle_day_logs_cycle
  ON cycle_day_logs(cycle_id);

CREATE INDEX IF NOT EXISTS idx_hormonal_state_user_date
  ON hormonal_state_daily(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_cycle_insights_user_ack
  ON cycle_insights(user_id, user_acknowledged);

-- =====================================================================
-- TRIGGERS · updated_at automático
-- =====================================================================

CREATE OR REPLACE FUNCTION update_women_health_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_women_health_profile_updated ON women_health_profile;
CREATE TRIGGER trg_women_health_profile_updated
  BEFORE UPDATE ON women_health_profile
  FOR EACH ROW EXECUTE FUNCTION update_women_health_updated_at();

DROP TRIGGER IF EXISTS trg_cycle_logs_updated ON cycle_logs;
CREATE TRIGGER trg_cycle_logs_updated
  BEFORE UPDATE ON cycle_logs
  FOR EACH ROW EXECUTE FUNCTION update_women_health_updated_at();

DROP TRIGGER IF EXISTS trg_cycle_day_logs_updated ON cycle_day_logs;
CREATE TRIGGER trg_cycle_day_logs_updated
  BEFORE UPDATE ON cycle_day_logs
  FOR EACH ROW EXECUTE FUNCTION update_women_health_updated_at();

-- =====================================================================
-- ROW LEVEL SECURITY (RLS)
-- Cada tabla: user solo accede a sus propias rows.
-- Schema B2B-ready: clinician_user_id futuro tendrá policy adicional.
-- =====================================================================

ALTER TABLE women_health_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_day_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hormonal_state_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_insights        ENABLE ROW LEVEL SECURITY;

-- women_health_profile
DROP POLICY IF EXISTS women_health_profile_select ON women_health_profile;
CREATE POLICY women_health_profile_select ON women_health_profile
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS women_health_profile_insert ON women_health_profile;
CREATE POLICY women_health_profile_insert ON women_health_profile
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS women_health_profile_update ON women_health_profile;
CREATE POLICY women_health_profile_update ON women_health_profile
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS women_health_profile_delete ON women_health_profile;
CREATE POLICY women_health_profile_delete ON women_health_profile
  FOR DELETE USING (auth.uid() = user_id);

-- cycle_logs
DROP POLICY IF EXISTS cycle_logs_select ON cycle_logs;
CREATE POLICY cycle_logs_select ON cycle_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_logs_insert ON cycle_logs;
CREATE POLICY cycle_logs_insert ON cycle_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_logs_update ON cycle_logs;
CREATE POLICY cycle_logs_update ON cycle_logs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_logs_delete ON cycle_logs;
CREATE POLICY cycle_logs_delete ON cycle_logs
  FOR DELETE USING (auth.uid() = user_id);

-- cycle_day_logs
DROP POLICY IF EXISTS cycle_day_logs_select ON cycle_day_logs;
CREATE POLICY cycle_day_logs_select ON cycle_day_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_day_logs_insert ON cycle_day_logs;
CREATE POLICY cycle_day_logs_insert ON cycle_day_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_day_logs_update ON cycle_day_logs;
CREATE POLICY cycle_day_logs_update ON cycle_day_logs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_day_logs_delete ON cycle_day_logs;
CREATE POLICY cycle_day_logs_delete ON cycle_day_logs
  FOR DELETE USING (auth.uid() = user_id);

-- hormonal_state_daily
DROP POLICY IF EXISTS hormonal_state_daily_select ON hormonal_state_daily;
CREATE POLICY hormonal_state_daily_select ON hormonal_state_daily
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS hormonal_state_daily_insert ON hormonal_state_daily;
CREATE POLICY hormonal_state_daily_insert ON hormonal_state_daily
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS hormonal_state_daily_update ON hormonal_state_daily;
CREATE POLICY hormonal_state_daily_update ON hormonal_state_daily
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS hormonal_state_daily_delete ON hormonal_state_daily;
CREATE POLICY hormonal_state_daily_delete ON hormonal_state_daily
  FOR DELETE USING (auth.uid() = user_id);

-- cycle_insights
DROP POLICY IF EXISTS cycle_insights_select ON cycle_insights;
CREATE POLICY cycle_insights_select ON cycle_insights
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_insights_insert ON cycle_insights;
CREATE POLICY cycle_insights_insert ON cycle_insights
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_insights_update ON cycle_insights;
CREATE POLICY cycle_insights_update ON cycle_insights
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cycle_insights_delete ON cycle_insights;
CREATE POLICY cycle_insights_delete ON cycle_insights
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================================
-- VERIFICACIÓN POST-INSTALL
-- Después de correr, ejecutá esto para confirmar:
-- =====================================================================
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'women_health_profile','cycle_logs','cycle_day_logs',
--     'hormonal_state_daily','cycle_insights'
--   )
-- ORDER BY table_name;
--
-- Debe devolver 5 rows.
--
-- =====================================================================
