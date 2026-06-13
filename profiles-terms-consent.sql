-- =====================================================================
-- SAVIA — Profile: terms consent columns (Sprint Seguridad Fase 0)
-- =====================================================================
-- Persiste cuándo y qué versión de Términos/Privacidad aceptó el usuario.
-- Requerido por leyes de protección de datos (Costa Rica Ley 8968,
-- México LFPDPPP, GDPR equivalentes) para demostrar consentimiento.
--
-- Idempotente. Correr en Supabase SQL Editor.
-- =====================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT;

COMMENT ON COLUMN profiles.terms_accepted_at IS
  'Timestamp cuando el usuario aceptó los Términos y Política de Privacidad.';
COMMENT ON COLUMN profiles.terms_version IS
  'Versión de los Términos aceptados (por fecha de actualización).';

-- =====================================================================
-- Verificación:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles'
--     AND column_name IN ('terms_accepted_at', 'terms_version');
-- =====================================================================
