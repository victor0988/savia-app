-- =========================================================
-- SAVIA: body_compositions table + Storage bucket
-- B2B-ready desde día 1: patient_user_id ≠ uploaded_by_user_id
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

-- 1) Tabla principal
CREATE TABLE IF NOT EXISTS body_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('self', 'clinic')),
  method TEXT NOT NULL CHECK (method IN ('inbody', 'silhouette', 'waist', 'dxa', 'manual')),
  measured_at TIMESTAMPTZ DEFAULT NOW(),

  -- Métricas (todas opcionales para soportar distintos métodos)
  weight_kg DECIMAL(5,2),
  body_fat_pct DECIMAL(4,1),
  muscle_mass_kg DECIMAL(5,2),
  lean_body_mass_kg DECIMAL(5,2),
  visceral_fat_level INTEGER,
  bmr_kcal INTEGER,
  total_body_water_kg DECIMAL(5,2),

  -- Source files + raw data
  photo_url TEXT,           -- storage path al PDF/foto original
  raw_data JSONB,           -- TODOS los campos extraídos del InBody (futuro-proof)
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_comp_patient_measured
  ON body_compositions(patient_user_id, measured_at DESC);

-- 2) RLS — POC: solo self-upload. B2B futuro extiende estas policies.
ALTER TABLE body_compositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own compositions" ON body_compositions;
CREATE POLICY "Users see own compositions"
  ON body_compositions FOR SELECT
  USING (auth.uid() = patient_user_id);

DROP POLICY IF EXISTS "Users insert own compositions" ON body_compositions;
CREATE POLICY "Users insert own compositions"
  ON body_compositions FOR INSERT
  WITH CHECK (
    auth.uid() = patient_user_id
    AND auth.uid() = uploaded_by_user_id
  );

DROP POLICY IF EXISTS "Users update own compositions" ON body_compositions;
CREATE POLICY "Users update own compositions"
  ON body_compositions FOR UPDATE
  USING (auth.uid() = patient_user_id);

DROP POLICY IF EXISTS "Users delete own compositions" ON body_compositions;
CREATE POLICY "Users delete own compositions"
  ON body_compositions FOR DELETE
  USING (auth.uid() = patient_user_id);

-- 3) Bucket Storage 'body-comps' — privado, max 5 MB (PDFs InBody pueden pesar más que fotos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('body-comps', 'body-comps', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path esperado: body-comps/{patient_user_id}/{timestamp}-{filename}
-- En B2B la doctora podrá escribir bajo {patient_user_id} aunque ella no sea ese user.
-- Por ahora, solo el dueño puede leer/escribir bajo su carpeta.

DROP POLICY IF EXISTS "Users see own body-comps" ON storage.objects;
CREATE POLICY "Users see own body-comps"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'body-comps'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users upload own body-comps" ON storage.objects;
CREATE POLICY "Users upload own body-comps"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'body-comps'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own body-comps" ON storage.objects;
CREATE POLICY "Users delete own body-comps"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'body-comps'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
