-- =========================================================
-- SAVIA: daily_logs (sueño + pasos manual mientras no hay wearable)
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  log_date DATE NOT NULL,

  -- Sueño
  sleep_hours DECIMAL(3,1),
  sleep_rating INTEGER CHECK (sleep_rating BETWEEN 1 AND 5),
  sleep_notes TEXT,

  -- Pasos
  steps INTEGER,

  -- Source (manual hoy, futuro wearable)
  source TEXT DEFAULT 'manual',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date
  ON daily_logs(user_id, log_date DESC);

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own daily" ON daily_logs;
CREATE POLICY "Users see own daily"
  ON daily_logs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own daily" ON daily_logs;
CREATE POLICY "Users insert own daily"
  ON daily_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own daily" ON daily_logs;
CREATE POLICY "Users update own daily"
  ON daily_logs FOR UPDATE USING (auth.uid() = user_id);
