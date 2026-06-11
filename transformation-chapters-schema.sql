-- =====================================================================
-- SAVIA — Transformation Chapters (Sprint 3.B.ext.1)
-- =====================================================================
-- Biblioteca de capítulos de transformación personal del usuario.
--
-- Filosofía:
--   El producto no es el InBody. El producto no es el review. El producto
--   es esta colección de capítulos persistentes que, acumulados durante
--   años, demuestra que SAVIA estuvo presente durante la transformación
--   del usuario.
--
-- Schema decisions clave:
--   - Polimórfico: source_type identifica el disparador del capítulo.
--     Sprint 1 solo procesa 'inbody'. CHECK incluye los tipos previstos
--     del roadmap para que ALTER futuro sea trivial.
--   - source_id sin FK: chapters deben sobrevivir al borrado del source.
--     Si el user borra un body_composition, el capítulo persiste con
--     source_id = NULL. La biblioteca es el activo, no el dato técnico.
--   - Snapshots inmutables (goals_snapshot, identity_snapshot,
--     narrative_context): sin esto, un user que cambia goals en 3 meses
--     vería su capítulo histórico "actualizado" — eso rompe la promesa
--     de continuidad biográfica.
--   - "La review no puede fallar": generation_status binario; si Claude
--     falla todos los retries, el server genera un fallback determinístico.
--
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS transformation_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ─── Origen polimórfico ──────────────────────────────────────────
  -- source_type incluye tipos previstos del roadmap aunque Sprint 1
  -- solo genere 'inbody'. ALTER del CHECK para sumar tipos es trivial.
  -- source_id sin FK: polimorfismo + chapter sobrevive al source borrado.
  source_type TEXT NOT NULL CHECK (source_type IN (
    'inbody',              -- Sprint 1 (único activo)
    'onboarding_baseline', -- Sprint 2
    'weekly_review',       -- Sprint 4
    'milestone',           -- Sprint 4+
    'plateau',             -- Sprint 4+
    'reunion'              -- futuro
  )),
  source_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ─── Las 4 secciones biográficas (prosa, NO markdown) ────────────
  -- Para el primer chapter de un user, arc_until_now y
  -- what_this_moment_means pueden ser null (no hay historia previa).
  -- how_you_are_today siempre presente. where_i_invite_you también.
  how_you_are_today TEXT NOT NULL,
  arc_until_now TEXT,
  what_this_moment_means TEXT,
  where_i_invite_you TEXT,

  -- ─── Voz del usuario en el momento (opcional, capturada en upload) ─
  -- Una a tres frases que el usuario escribió antes de subir su medición.
  -- En 3 años, este es probablemente el campo más valioso del capítulo:
  -- es la voz del usuario hablando con su yo futuro.
  user_reflection TEXT,

  -- ─── Anchor visual (preparado para Sprint 2) ───────────────────────
  -- Sprint 1 lo deja null. Sprint 2 permite al usuario adjuntar una foto
  -- al momento del upload. Sin reservar el campo hoy, agregarlo después
  -- sería migración con UI rewriting.
  cover_image_url TEXT,

  -- ─── Snapshots inmutables del contexto del momento ─────────────────
  -- Sin estos, el activo se rompe el día que el user cambia goals.
  -- La biblioteca debe contar la verdad histórica, no la verdad actual.
  goals_snapshot JSONB,
  identity_snapshot JSONB,

  -- ─── Narrative context para continuidad biográfica ─────────────────
  -- {analysis_number, days_since_signup, days_since_first_measurement}
  -- En Sprint 2+ se enriquece con behavioral_snapshot, etc.
  narrative_context JSONB,

  -- ─── Transparencia de generación ───────────────────────────────────
  generation_status TEXT NOT NULL DEFAULT 'generated'
    CHECK (generation_status IN ('generated', 'deterministic_fallback')),
  -- {model, prompt_version, attempts, error_if_fallback}
  generation_metadata JSONB
);

-- ─── Indexes ────────────────────────────────────────────────────────
-- Para "Tu Historia" listing (query principal del feature)
CREATE INDEX IF NOT EXISTS idx_tc_user_created
  ON transformation_chapters(user_id, created_at DESC);

-- Para lookup del chapter de un source específico desde la EF
-- UNIQUE para race protection: si dos requests concurrentes intentan crear
-- el chapter del mismo source, la segunda recibe 23505 y la EF devuelve
-- el chapter que ganó. WHERE source_id IS NOT NULL permite múltiples
-- chapters huérfanos cuando el source original fue borrado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_source_unique
  ON transformation_chapters(source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE transformation_chapters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own chapters" ON transformation_chapters;
CREATE POLICY "Users see own chapters" ON transformation_chapters
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "No client inserts" ON transformation_chapters;
CREATE POLICY "No client inserts" ON transformation_chapters
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "No client updates" ON transformation_chapters;
CREATE POLICY "No client updates" ON transformation_chapters
  FOR UPDATE USING (false);

-- =====================================================================
-- Verificación post-install:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'transformation_chapters' ORDER BY ordinal_position;
-- Debe devolver 13 columnas.
-- =====================================================================
