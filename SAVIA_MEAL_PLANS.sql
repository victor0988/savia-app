-- =========================================================
-- SAVIA: meal_plans + tablas relacionadas
-- B2B-ready desde día 1: patient_user_id ≠ uploaded_by_user_id
-- Run en: https://supabase.com/dashboard/project/vlzzgttjrpyywmahwooi/sql/new
-- =========================================================

-- 1) MEAL_PLANS — header del plan
CREATE TABLE IF NOT EXISTS meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('self', 'clinic')),

  -- Branding del plan
  title TEXT,                                -- ej: "Plan Recomposición 2495 kcal"
  nutritionist_name TEXT,                    -- ej: "Dra. Sofía López"
  nutritionist_contact TEXT,                 -- ej: "+506 6403-6566"
  nutritionist_handle TEXT,                  -- ej: "Dra.SofiaLopez" (Instagram/FB)
  motivational_quote TEXT,                   -- frase al final del plan

  -- Targets del plan (sobrescriben los de nutrition_targets cuando hay plan activo)
  total_kcal INTEGER,
  total_protein_g DECIMAL(6,1),
  total_carbs_g DECIMAL(6,1),
  total_fat_g DECIMAL(6,1),
  water_ml_target INTEGER,
  protein_per_kg DECIMAL(4,2),               -- ej: 2.4 g/kg si lo dice el plan

  -- Source files + raw data
  source_file_url TEXT,                       -- storage path al PDF/foto original
  raw_parsed_json JSONB,                      -- output completo de Claude (debug + reparse)

  -- Estado
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at DATE DEFAULT CURRENT_DATE,
  ends_at DATE,                               -- null = sin expiración

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meal_plans_patient_active
  ON meal_plans(patient_user_id, active, created_at DESC);

-- Solo 1 plan activo por paciente (constraint parcial)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_plans_one_active_per_patient
  ON meal_plans(patient_user_id) WHERE active = TRUE;

-- 2) PLAN_MEALS — slots de comida (desayuno, merienda, etc.)
CREATE TABLE IF NOT EXISTS plan_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE NOT NULL,

  slot TEXT NOT NULL,                         -- 'desayuno', 'merienda', 'pre_entreno', 'almuerzo', 'snack_pm', 'cena', 'post_entreno', etc.
  custom_label TEXT,                          -- override del slot ej: "Pre entreno rápido"
  display_order INTEGER NOT NULL DEFAULT 0,
  scheduled_time TIME,                        -- horario sugerido ej '09:00:00'
  scheduled_time_label TEXT,                  -- raw del PDF ej "3:30-4 PM"

  -- Grupos de alternativas: comidas mutuamente excluyentes (ej: Pre entreno completo vs Pre entreno rápido)
  alternative_group TEXT,                     -- mismo string = alternativas entre sí (ej 'pre_entreno_alt')
  alternative_label TEXT,                     -- 'A' / 'B' para mostrar como tabs

  -- Macros estimados (suma de items)
  total_kcal_est INTEGER,
  total_protein_g_est DECIMAL(5,1),
  total_carbs_g_est DECIMAL(5,1),
  total_fat_g_est DECIMAL(5,1),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_meals_plan_order
  ON plan_meals(plan_id, display_order);

-- 3) PLAN_MEAL_ITEMS — alimentos individuales dentro de cada comida
CREATE TABLE IF NOT EXISTS plan_meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID REFERENCES plan_meals(id) ON DELETE CASCADE NOT NULL,

  name TEXT NOT NULL,                         -- ej: "4 huevos enteros" o "Pechuga de pollo desmenuzada"
  quantity_text TEXT,                         -- raw del PDF: "4", "250g", "180g", "Libre"
  quantity_g DECIMAL(7,2),                    -- gramos parseados (null si "libre")
  unit_count DECIMAL(5,2),                    -- para unidades discretas (4 huevos, 2 rebanadas)

  -- Agrupación para selección
  selection_group TEXT,                       -- 'protein', 'carb', 'fruit', 'fat', 'vegetable', 'beverage', 'free'
  is_required BOOLEAN DEFAULT TRUE,           -- false = el user elige entre opciones del mismo selection_group
  is_free_quantity BOOLEAN DEFAULT FALSE,     -- true = "libre" / "al gusto"

  -- Macros estimados
  kcal_est INTEGER,
  protein_g_est DECIMAL(5,1),
  carbs_g_est DECIMAL(5,1),
  fat_g_est DECIMAL(5,1),

  -- Para futuro lookup en Open Food Facts
  off_barcode TEXT,                           -- código de barras si lo encontramos
  off_product_id TEXT,                        -- ID en OFF
  macros_source TEXT DEFAULT 'claude_estimate', -- 'claude_estimate' | 'open_food_facts' | 'user_edit'

  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_meal_items_meal_order
  ON plan_meal_items(meal_id, display_order);

-- 4) PLAN_SUPPLEMENTS — suplementos prescritos en el plan
CREATE TABLE IF NOT EXISTS plan_supplements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE NOT NULL,

  name TEXT NOT NULL,                         -- ej: "Creatina", "Magnesio", "Omega 3"
  dose TEXT,                                  -- ej: "5g diarios", "1 scoop", "2 cápsulas"
  timing TEXT,                                -- ej: "Antes de dormir", "Pre entreno", "Diario"
  display_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_supplements_plan
  ON plan_supplements(plan_id, display_order);

-- 5) PLAN_RULES — observaciones y reglas condicionales del plan
CREATE TABLE IF NOT EXISTS plan_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE NOT NULL,

  rule_type TEXT NOT NULL DEFAULT 'general' CHECK (rule_type IN ('general', 'conditional', 'hydration', 'supplement')),
  rule_text TEXT NOT NULL,                    -- texto crudo de la observación
  display_order INTEGER NOT NULL DEFAULT 0,

  -- Para futuras reglas accionables por la IA
  trigger_condition JSONB,                    -- ej: {"metric":"weight","change_kg":-0.5,"period_weeks":2}
  trigger_action JSONB,                       -- ej: {"adjust":"carbs_g","delta":25}

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_rules_plan
  ON plan_rules(plan_id, display_order);

-- =========================================================
-- 6) Columnas nuevas en meal_logs para tracking de adherencia al plan
-- =========================================================
ALTER TABLE meal_logs
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_meal_id UUID REFERENCES plan_meals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_meal_item_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS from_plan BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_meal_logs_plan_adherence
  ON meal_logs(user_id, plan_id, ts DESC) WHERE plan_id IS NOT NULL;

-- =========================================================
-- 7) RLS POLICIES (MVP self-only; B2B futuro extiende)
-- =========================================================
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_supplements ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_rules ENABLE ROW LEVEL SECURITY;

-- meal_plans
DROP POLICY IF EXISTS "Users see own plans" ON meal_plans;
CREATE POLICY "Users see own plans"
  ON meal_plans FOR SELECT USING (auth.uid() = patient_user_id);

DROP POLICY IF EXISTS "Users insert own plans" ON meal_plans;
CREATE POLICY "Users insert own plans"
  ON meal_plans FOR INSERT
  WITH CHECK (auth.uid() = patient_user_id AND auth.uid() = uploaded_by_user_id);

DROP POLICY IF EXISTS "Users update own plans" ON meal_plans;
CREATE POLICY "Users update own plans"
  ON meal_plans FOR UPDATE USING (auth.uid() = patient_user_id);

DROP POLICY IF EXISTS "Users delete own plans" ON meal_plans;
CREATE POLICY "Users delete own plans"
  ON meal_plans FOR DELETE USING (auth.uid() = patient_user_id);

-- plan_meals (cascada vía plan_id)
DROP POLICY IF EXISTS "Users see own plan meals" ON plan_meals;
CREATE POLICY "Users see own plan meals"
  ON plan_meals FOR SELECT USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_meals.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users insert own plan meals" ON plan_meals;
CREATE POLICY "Users insert own plan meals"
  ON plan_meals FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_meals.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users update own plan meals" ON plan_meals;
CREATE POLICY "Users update own plan meals"
  ON plan_meals FOR UPDATE USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_meals.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users delete own plan meals" ON plan_meals;
CREATE POLICY "Users delete own plan meals"
  ON plan_meals FOR DELETE USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_meals.plan_id AND p.patient_user_id = auth.uid())
  );

-- plan_meal_items
DROP POLICY IF EXISTS "Users see own plan items" ON plan_meal_items;
CREATE POLICY "Users see own plan items"
  ON plan_meal_items FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_meals m
      JOIN meal_plans p ON p.id = m.plan_id
      WHERE m.id = plan_meal_items.meal_id AND p.patient_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users insert own plan items" ON plan_meal_items;
CREATE POLICY "Users insert own plan items"
  ON plan_meal_items FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plan_meals m
      JOIN meal_plans p ON p.id = m.plan_id
      WHERE m.id = plan_meal_items.meal_id AND p.patient_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users update own plan items" ON plan_meal_items;
CREATE POLICY "Users update own plan items"
  ON plan_meal_items FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plan_meals m
      JOIN meal_plans p ON p.id = m.plan_id
      WHERE m.id = plan_meal_items.meal_id AND p.patient_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users delete own plan items" ON plan_meal_items;
CREATE POLICY "Users delete own plan items"
  ON plan_meal_items FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plan_meals m
      JOIN meal_plans p ON p.id = m.plan_id
      WHERE m.id = plan_meal_items.meal_id AND p.patient_user_id = auth.uid()
    )
  );

-- plan_supplements
DROP POLICY IF EXISTS "Users see own supplements" ON plan_supplements;
CREATE POLICY "Users see own supplements"
  ON plan_supplements FOR SELECT USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_supplements.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users insert own supplements" ON plan_supplements;
CREATE POLICY "Users insert own supplements"
  ON plan_supplements FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_supplements.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users update own supplements" ON plan_supplements;
CREATE POLICY "Users update own supplements"
  ON plan_supplements FOR UPDATE USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_supplements.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users delete own supplements" ON plan_supplements;
CREATE POLICY "Users delete own supplements"
  ON plan_supplements FOR DELETE USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_supplements.plan_id AND p.patient_user_id = auth.uid())
  );

-- plan_rules
DROP POLICY IF EXISTS "Users see own rules" ON plan_rules;
CREATE POLICY "Users see own rules"
  ON plan_rules FOR SELECT USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_rules.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users insert own rules" ON plan_rules;
CREATE POLICY "Users insert own rules"
  ON plan_rules FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_rules.plan_id AND p.patient_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users delete own rules" ON plan_rules;
CREATE POLICY "Users delete own rules"
  ON plan_rules FOR DELETE USING (
    EXISTS (SELECT 1 FROM meal_plans p WHERE p.id = plan_rules.plan_id AND p.patient_user_id = auth.uid())
  );

-- =========================================================
-- 8) Storage bucket para PDFs/fotos de planes
-- =========================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('meal-plans', 'meal-plans', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path esperado: meal-plans/{patient_user_id}/{timestamp}-{filename}
DROP POLICY IF EXISTS "Users see own meal-plans" ON storage.objects;
CREATE POLICY "Users see own meal-plans"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'meal-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users upload own meal-plans" ON storage.objects;
CREATE POLICY "Users upload own meal-plans"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'meal-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own meal-plans" ON storage.objects;
CREATE POLICY "Users delete own meal-plans"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'meal-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
