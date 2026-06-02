-- =========================================================
-- SAVIA Storage: bucket "food-photos" para fotos de comida
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

-- 1) Crear bucket privado (solo accesible vía signed URLs o JWT del owner)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('food-photos', 'food-photos', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS policies: cada user solo puede ver/subir/borrar SUS fotos.
-- Estructura de path esperada: {user_id}/{filename}.jpg

DROP POLICY IF EXISTS "Users see own food photos" ON storage.objects;
CREATE POLICY "Users see own food photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'food-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users upload own food photos" ON storage.objects;
CREATE POLICY "Users upload own food photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'food-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own food photos" ON storage.objects;
CREATE POLICY "Users delete own food photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'food-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) (Opcional pero recomendado) Agregar columna photo_url a meal_logs
ALTER TABLE meal_logs
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
