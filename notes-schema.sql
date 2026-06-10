-- =====================================================================
-- SAVIA Notes — Schema v1 (Sprint 1.B — Health Twin Foundation)
-- =====================================================================
-- Foundation de la capa de captura de memoria para SAVIA.
-- En Sprint 1 SOLO se captura (sin uso en coach). Retrieval semántico
-- viene en Sprint 4. Embeddings se computan después.
--
-- Decisiones de diseño (validadas en discusión arquitectónica):
--   - Tabla genérica simple: 4 kinds + 3 sources + closes_with opcional
--   - Sin Personal Laws, Beliefs, Dimensions, Exchanges como entidad
--   - text + created_at + kind + source son el activo IRRECUPERABLE
--   - closes_with privilegia decisiones (situación + decisión + outcome)
--   - last_referenced_at permite freshness scoring en retrieval futuro
--
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

-- pgvector extension (necesaria para Sprint 4 retrieval semántico)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ─── Contenido ───
  -- Texto literal de la observación/preferencia/constraint/pattern.
  -- Cap de 2000 chars: cualquier note bien capturada cabe holgada acá.
  text TEXT NOT NULL
    CHECK (char_length(text) BETWEEN 1 AND 2000),

  -- 4 kinds funcionalmente distintos (no taxonomía profunda, no dimensions)
  kind TEXT NOT NULL CHECK (kind IN (
    'preference',   -- "no me gusta entrenar en ayunas", "prefiero pollo a pescado"
    'constraint',   -- intolerancias, restricciones (no negociables)
    'observation',  -- eventos, estados, contexto temporal con peso longitudinal
    'pattern'       -- derivado de compute jobs (Best Week Anatomy, etc.)
  )),

  -- 3 sources para distinguir lenguaje en uso ("me dijiste" vs "noté" vs "los datos")
  source TEXT NOT NULL CHECK (source IN (
    'user_said',      -- el usuario lo dijo literalmente en conversación
    'coach_observed', -- SAVIA lo notó analizando el momento
    'computed'        -- output de Best Week Anatomy u otro compute job
  )),

  -- ─── Decision loops (privilegian aprendizaje sobre memoria) ───
  -- JSONB nullable. Cuando existe, la note es "learning material":
  -- { decision: "descansar el martes",
  --   outcome_status: "open" | "closed" | "skipped",
  --   outcome: "esa semana terminó siendo la mejor del mes (adherencia 87%)",
  --   closed_at: "2026-05-22T..." }
  -- Permite que el coach detecte cuándo una experiencia pasada es aplicable
  -- al momento actual con causalidad observada.
  closes_with JSONB
    CHECK (closes_with IS NULL OR jsonb_typeof(closes_with) = 'object'),

  -- ─── Retrieval support (preparado para Sprint 4) ───
  -- Embedding text-embedding-3-small (1536 dims). Nullable en Sprint 1 —
  -- se computa en Sprint 4. Permite backfill sin migración.
  embedding vector(1536),

  -- Freshness: cuándo SAVIA usó esta note por última vez en una conversación.
  -- Permite boost de recencia + penalización a notes muy usadas (diversidad).
  last_referenced_at TIMESTAMPTZ,
  reference_count INTEGER NOT NULL DEFAULT 0,

  -- ─── Metadata ───
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- archived: soft delete. User puede archivar manualmente o context shift
  -- detection (Year 2) puede archivar automáticamente.
  archived BOOLEAN NOT NULL DEFAULT FALSE
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Para retrieval por user (siempre filtra por user_id activo)
CREATE INDEX IF NOT EXISTS idx_notes_user_active
  ON notes(user_id, created_at DESC)
  WHERE archived = false;

-- Para filtrado por kind cuando el retriever necesite tipos específicos
CREATE INDEX IF NOT EXISTS idx_notes_user_kind
  ON notes(user_id, kind, created_at DESC)
  WHERE archived = false;

-- Para encontrar notes con loops abiertos pendientes de cierre
CREATE INDEX IF NOT EXISTS idx_notes_open_loops
  ON notes(user_id, created_at DESC)
  WHERE archived = false
    AND closes_with IS NOT NULL
    AND closes_with->>'outcome_status' = 'open';

-- Embedding similarity index (HNSW, mejor para Sprint 4 retrieval)
-- Se crea aunque embedding sea null hoy — pgvector lo maneja.
CREATE INDEX IF NOT EXISTS idx_notes_embedding
  ON notes USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_select ON notes;
CREATE POLICY notes_select ON notes
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- Insert: solo via service_role (Edge Function). El coach decide capture.
DROP POLICY IF EXISTS notes_insert ON notes;
CREATE POLICY notes_insert ON notes
  FOR INSERT WITH CHECK (false);

-- Update: user puede archivar y modificar last_referenced_at vía sus
-- propias interacciones. WITH CHECK previene reasignación cross-user.
DROP POLICY IF EXISTS notes_update ON notes;
CREATE POLICY notes_update ON notes
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
            WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS notes_delete ON notes;
CREATE POLICY notes_delete ON notes
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- =====================================================================
-- Verificación post-install:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'notes';
--   SELECT extname FROM pg_extension WHERE extname = 'vector';
-- Ambas queries deben devolver 1 row.
-- =====================================================================
