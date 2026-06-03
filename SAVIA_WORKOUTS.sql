-- =========================================================
-- SAVIA: workout_logs table
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

CREATE TABLE IF NOT EXISTS workout_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW(),

  -- Identificación del workout
  type TEXT NOT NULL,                -- 'run' | 'bike' | 'swim' | 'walk' | 'strength' | 'hiit' | 'yoga' | 'other'
  name TEXT,                         -- nombre custom opcional ("morning run", "leg day")

  -- Métricas
  duration_min INTEGER NOT NULL,
  intensity TEXT,                    -- 'light' | 'moderate' | 'vigorous' (afecta cálculo kcal)
  kcal_burned INTEGER,               -- calorías quemadas (auto-calculado o manual override)
  distance_km DECIMAL(6,2),          -- opcional (cardio)
  avg_hr INTEGER,                    -- bpm promedio opcional
  notes TEXT,

  -- Source tracking
  source TEXT DEFAULT 'manual',      -- 'manual' | 'strava' | 'coros' | 'apple_health' | 'whoop' | 'garmin'
  external_id TEXT,                  -- ID de la actividad en la fuente externa (para dedup)
  external_url TEXT,                 -- link a la actividad en la app externa (ej: strava activity URL)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_logs_user_ts
  ON workout_logs(user_id, ts DESC);

-- Index para dedup por external_id (prevenir importar 2x la misma actividad de Strava)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_logs_external_unique
  ON workout_logs(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- RLS
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own workouts" ON workout_logs;
CREATE POLICY "Users see own workouts"
  ON workout_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own workouts" ON workout_logs;
CREATE POLICY "Users insert own workouts"
  ON workout_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own workouts" ON workout_logs;
CREATE POLICY "Users update own workouts"
  ON workout_logs FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own workouts" ON workout_logs;
CREATE POLICY "Users delete own workouts"
  ON workout_logs FOR DELETE
  USING (auth.uid() = user_id);
