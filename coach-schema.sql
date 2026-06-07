-- =====================================================================
-- SAVIA AI Coach — Schema v1
-- =====================================================================
-- 2 tablas: coach_threads + coach_messages
-- Storage de conversaciones para contexto multi-turno + memoria
-- Correr en Supabase SQL Editor. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABLA 1 · coach_threads
-- Una thread por conversación. MVP: 1 thread "default" por user.
-- V2: múltiples threads con titles.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title TEXT DEFAULT 'Chat con SAVIA',
  is_default BOOLEAN DEFAULT TRUE,        -- el thread principal (V2 multi-thread)
  archived BOOLEAN DEFAULT FALSE,

  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,              -- primer ~80 chars del último mensaje

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- TABLA 2 · coach_messages
-- Cada turno de la conversación. role = user | assistant | tool
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES coach_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),

  -- Para role='user' o 'assistant': el texto
  content TEXT,

  -- Para role='assistant' cuando Claude llama una tool:
  tool_call_id TEXT,                      -- ID que da Claude al tool_use block
  tool_name TEXT,                         -- 'log_meal', 'get_balance', etc.
  tool_input JSONB,                       -- args que Claude pasa

  -- Para role='tool' (respuesta de la ejecución):
  tool_output JSONB,                      -- resultado de ejecutar la tool
  tool_error TEXT,                        -- si falló, error message

  -- Token tracking (para cost monitoring)
  input_tokens INTEGER,
  output_tokens INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_coach_threads_user
  ON coach_threads(user_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_coach_messages_thread_created
  ON coach_messages(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_coach_messages_user
  ON coach_messages(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- TRIGGERS · updated_at + thread metadata bump
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_coach_threads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coach_threads_updated ON coach_threads;
CREATE TRIGGER trg_coach_threads_updated
  BEFORE UPDATE ON coach_threads
  FOR EACH ROW EXECUTE FUNCTION update_coach_threads_updated_at();

-- Bump del thread cuando se inserta un mensaje
CREATE OR REPLACE FUNCTION bump_coach_thread_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE coach_threads
    SET message_count = COALESCE(message_count, 0) + 1,
        last_message_at = NEW.created_at,
        last_message_preview = LEFT(COALESCE(NEW.content, ''), 80)
    WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coach_messages_bump_thread ON coach_messages;
CREATE TRIGGER trg_coach_messages_bump_thread
  AFTER INSERT ON coach_messages
  FOR EACH ROW EXECUTE FUNCTION bump_coach_thread_on_message();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
ALTER TABLE coach_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;

-- coach_threads
DROP POLICY IF EXISTS coach_threads_select ON coach_threads;
CREATE POLICY coach_threads_select ON coach_threads
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_threads_insert ON coach_threads;
CREATE POLICY coach_threads_insert ON coach_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_threads_update ON coach_threads;
CREATE POLICY coach_threads_update ON coach_threads
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_threads_delete ON coach_threads;
CREATE POLICY coach_threads_delete ON coach_threads
  FOR DELETE USING (auth.uid() = user_id);

-- coach_messages
DROP POLICY IF EXISTS coach_messages_select ON coach_messages;
CREATE POLICY coach_messages_select ON coach_messages
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_messages_insert ON coach_messages;
CREATE POLICY coach_messages_insert ON coach_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_messages_update ON coach_messages;
CREATE POLICY coach_messages_update ON coach_messages
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS coach_messages_delete ON coach_messages;
CREATE POLICY coach_messages_delete ON coach_messages
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================================
-- Verificación:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('coach_threads','coach_messages');
-- Debe devolver 2 rows.
-- =====================================================================
