-- =========================================================
-- SAVIA Nutrition Module — Database Schema
-- Run this in: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

-- 1) Profile extension (nutrition fields)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS height_cm INTEGER,
  ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS body_fat_pct DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS activity_level TEXT,
  ADD COLUMN IF NOT EXISTS dietary_restrictions JSONB,
  ADD COLUMN IF NOT EXISTS dietary_preferences JSONB,
  ADD COLUMN IF NOT EXISTS nutrition_goal TEXT,
  ADD COLUMN IF NOT EXISTS meals_per_day INTEGER;

-- 2) Nutrition targets (calculated kcal + macros)
CREATE TABLE IF NOT EXISTS nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  kcal INTEGER NOT NULL,
  protein_g INTEGER NOT NULL,
  carbs_g INTEGER NOT NULL,
  fat_g INTEGER NOT NULL,
  water_ml INTEGER NOT NULL DEFAULT 2500,
  formula TEXT DEFAULT 'mifflin_stjeor_v1',
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_nutrition_targets_user_active ON nutrition_targets(user_id, active);

-- 3) Meal logs
CREATE TABLE IF NOT EXISTS meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW(),
  meal_category TEXT,
  source TEXT DEFAULT 'manual',
  items_text TEXT,
  total_kcal INTEGER NOT NULL DEFAULT 0,
  total_protein_g DECIMAL(6,1) DEFAULT 0,
  total_carbs_g DECIMAL(6,1) DEFAULT 0,
  total_fat_g DECIMAL(6,1) DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_ts ON meal_logs(user_id, ts DESC);

-- 4) Hydration logs
CREATE TABLE IF NOT EXISTS hydration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW(),
  ml INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hydration_logs_user_ts ON hydration_logs(user_id, ts DESC);

-- 5) RLS policies
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydration_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own targets" ON nutrition_targets;
DROP POLICY IF EXISTS "Users insert own targets" ON nutrition_targets;
DROP POLICY IF EXISTS "Users update own targets" ON nutrition_targets;
CREATE POLICY "Users see own targets" ON nutrition_targets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own targets" ON nutrition_targets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own targets" ON nutrition_targets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own meals" ON meal_logs;
DROP POLICY IF EXISTS "Users insert own meals" ON meal_logs;
DROP POLICY IF EXISTS "Users update own meals" ON meal_logs;
DROP POLICY IF EXISTS "Users delete own meals" ON meal_logs;
CREATE POLICY "Users see own meals" ON meal_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own meals" ON meal_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own meals" ON meal_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own meals" ON meal_logs FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own hydration" ON hydration_logs;
DROP POLICY IF EXISTS "Users insert own hydration" ON hydration_logs;
CREATE POLICY "Users see own hydration" ON hydration_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own hydration" ON hydration_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
