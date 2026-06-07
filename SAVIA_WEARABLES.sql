-- =========================================================
-- SAVIA: wearable_connections + wearable_sync_log
-- Tokens OAuth de wearables conectados (Strava, Whoop, Oura futuros).
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

-- 1) WEARABLE_CONNECTIONS — un row por (user, provider). El user puede tener varios providers.
CREATE TABLE IF NOT EXISTS wearable_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('strava', 'whoop', 'oura', 'garmin', 'apple_health', 'coros')),

  -- OAuth tokens
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,

  -- Identidad en el provider
  external_user_id TEXT,                  -- athlete.id en Strava, user.id en Whoop, etc.
  external_username TEXT,
  external_avatar_url TEXT,
  external_profile_raw JSONB,             -- payload completo del athlete para futuro use

  -- Estado de la conexión
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'error')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,

  -- Métricas
  total_activities_synced INTEGER DEFAULT 0,

  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Solo 1 conexión activa por user/provider
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_wearable_connections_user
  ON wearable_connections(user_id, status);

-- 2) WEARABLE_SYNC_LOG — historial de syncs para debug y observabilidad
CREATE TABLE IF NOT EXISTS wearable_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES wearable_connections(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,

  -- Resultado
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'no_new_data')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'auto', 'webhook')),

  -- Métricas del sync
  activities_fetched INTEGER DEFAULT 0,
  activities_inserted INTEGER DEFAULT 0,
  activities_skipped INTEGER DEFAULT 0,  -- ya existían (dedup por external_id)

  -- Para debugging
  api_calls INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wearable_sync_log_user
  ON wearable_sync_log(user_id, started_at DESC);

-- 3) RLS — solo el user dueño ve sus conexiones (tokens son secretos!)
ALTER TABLE wearable_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE wearable_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own connections" ON wearable_connections;
CREATE POLICY "Users see own connections"
  ON wearable_connections FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own connections" ON wearable_connections;
CREATE POLICY "Users insert own connections"
  ON wearable_connections FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own connections" ON wearable_connections;
CREATE POLICY "Users update own connections"
  ON wearable_connections FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own connections" ON wearable_connections;
CREATE POLICY "Users delete own connections"
  ON wearable_connections FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own sync log" ON wearable_sync_log;
CREATE POLICY "Users see own sync log"
  ON wearable_sync_log FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own sync log" ON wearable_sync_log;
CREATE POLICY "Users insert own sync log"
  ON wearable_sync_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4) Columnas adicionales en workout_logs para data de Strava
-- (las básicas external_id, external_url, source ya están)
ALTER TABLE workout_logs
  ADD COLUMN IF NOT EXISTS distance_m DECIMAL(9,2),         -- metros (Strava devuelve m)
  ADD COLUMN IF NOT EXISTS elevation_gain_m DECIMAL(7,2),
  ADD COLUMN IF NOT EXISTS max_hr INTEGER,
  ADD COLUMN IF NOT EXISTS avg_speed_mps DECIMAL(6,2),      -- m/s
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,          -- cuando empezó la actividad (Strava devuelve start_date)
  ADD COLUMN IF NOT EXISTS sport_type TEXT,                 -- raw del provider (Run, Ride, etc.)
  ADD COLUMN IF NOT EXISTS raw_data JSONB;                  -- payload completo de la API

CREATE INDEX IF NOT EXISTS idx_workout_logs_user_started
  ON workout_logs(user_id, started_at DESC) WHERE started_at IS NOT NULL;
