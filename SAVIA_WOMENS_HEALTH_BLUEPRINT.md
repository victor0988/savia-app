# SAVIA Women's Health OS

## Hormonal Intelligence Platform

*Blueprint estratégico v1 · Junio 2026*

---

## 1. Visión

> **"El primer sistema operativo de wellness que entiende el estado hormonal de la mujer y adapta automáticamente su nutrición, entrenamiento, sueño y recuperación."**

No es un period tracker. Es una capa de inteligencia hormonal que reescribe cada recomendación de SAVIA en función de la fase del ciclo. Flo te dice cuándo viene tu período; SAVIA te dice qué comer hoy, cuánto cargar en el gym hoy, y cuándo dormir mejor — todo según dónde estás en tu ciclo.

---

## 2. Análisis competitivo

| Producto | Fuerza | Debilidad | Lo que NO hace |
|---|---|---|---|
| **Flo** | UX juvenil, gran adopción, ML predictivo decente | Ads invasivos, datos vendidos, sin layer wellness | No integra nutrición, workout ni recovery |
| **Clue** | Científica, neutra, evidencia | UX más fría, menos personalizada | No tiene IA conversacional ni integraciones |
| **Natural Cycles** | FDA-approved como contracepción, basado en BBT | Laser-focused fertilidad, requiere termómetro diario | No habla de wellness amplio |
| **Oura** | Tracking biométrico real (HRV, BBT, sueño) | Cycle insights superficiales, no nutrición | No conecta ciclo con nutrición o plan de entreno |
| **Apple Health** | Aggregator de data | Sin inteligencia, sin coaching | Solo muestra datos, no recomienda |
| **Whoop** | Recovery science excelente | Sin tracking de ciclo, sin nutrición | Ignora hormonas femeninas |
| **Mira / Inito** | Mide LH/E3G urinarios reales | Costoso ($200+ ring + strips $1/día), fertilidad-only | Solo fertilidad, no wellness |

### Frustraciones de usuarias (validadas por research público + reviews)

1. **"Mi app de período no entiende mi vida"** — Flo/Clue no saben qué entrenaste, ni qué comiste. Pierden el contexto.
2. **"Los apps me hacen sentir patológica"** — listas largas de síntomas con tono médico generan ansiedad.
3. **"Las predicciones son malas si mi ciclo es irregular"** — apps que usan promedio simple fallan con PCOS, perimenopausia, anticonceptivos, postparto.
4. **"Me cobran por features básicos"** — Flo Premium $50/año por insights que deberían ser gratis.
5. **"Mi entrenador no entiende mi ciclo"** — apps de fitness ignoran fase hormonal, asumen ciclo de 28 días lineal.
6. **"Hay un sesgo masculino enorme en la wellness data"** — la mayoría de los estudios son en hombres, las apps usan baselines masculinos.

### Las 5 oportunidades reales (no genéricas)

1. **Hormonal Intelligence Engine cross-módulo** — nadie une cycle + nutrition + workout + sleep + recovery en una sola capa de inteligencia.
2. **Predicción adaptiva multi-señal** — no solo fechas. Predicción de energía, antojos, fuerza, mood usando HRV + BBT + sueño + actividad.
3. **Coaching conversacional específico** — "¿por qué tengo hambre así?" responde con: fase lútea + leptina + tu déficit calórico de ayer + workout intenso. Genérico no sirve.
4. **B2B integración con ginecólogas/endocrinólogas** — la doctora ve cycle + nutrition + workout en un dashboard clínico. SAVIA replica el modelo Sofía López para wellness femenino.
5. **Sin estigma cultural** — diseñado para Latam, idioma neutro pero femenino, no infantiliza.

---

## 3. Onboarding (< 2 min)

```
Paso 1: ¿Estás registrando ciclo menstrual?
   ○ Sí, ciclo natural
   ○ Sí, con anticonceptivo hormonal
   ○ Embarazada
   ○ Postparto
   ○ Perimenopausia
   ○ Menopausia
   ○ Prefiero no decir (skip módulo)

Paso 2 (si ciclo natural o anticonceptivo):
   - Edad
   - Duración promedio del ciclo (default 28, slider 21-45)
   - Duración del período (default 5, slider 2-9)
   - ¿Cuándo empezó tu último período? [date picker]

Paso 3: Objetivo principal
   ○ Conocer mi cuerpo mejor
   ○ Planear embarazo
   ○ Evitar embarazo (con consciencia ciclo)
   ○ Manejar síntomas (PMS, cólicos, mood)
   ○ Optimizar entrenamiento por fase
   ○ Optimizar nutrición por fase

Paso 4: Opcionales (skipeable)
   - Condiciones (PCOS, endometriosis, fibromas) — toggle list
   - ¿Tomas hormonas? (T, estradiol, progesterona)
   - ¿Tienes Apple Watch / Oura / Whoop? — para data hormonal real
```

**Default behavior**: si la usuaria skipea todo, SAVIA usa el período inicial + duración default y aprende con el tiempo. **NUNCA forzamos data sensitiva.**

---

## 4. Tracking del ciclo — UX mínimo-fricción

### Filosofía: 1 tap por día

Pantalla "Hoy" gana un mini-widget circular que muestra:
- **Día del ciclo** (ej. "Día 14")
- **Fase actual** (Folicular tardía)
- **Energía esperada** (alta, media, baja con dot color)

Tap → abre **CycleLog** sheet:

```
QUICK LOG (1 tap por categoría)
─────────────────────────────
🔴 Estoy en mi período · sí / no
💧 Flujo: ligero / medio / abundante
😣 Cólico: 0-3 (slider)
😴 Energía hoy: alta / media / baja
🍫 Antojos: dulce / salado / nada
🧠 Mood: bien / neutro / off
😴 Sueño anoche: bien / mal (referencia data Apple Watch)
```

**Cero text fields. Cero búsquedas. Cero síntomas en lista de 50.**

Síntomas frecuentes (cólicos, headache, breast tenderness, bloating) viven en una sección "+ Más" que solo se expande si la usuaria quiere.

---

## 5. Predicción inteligente

### Algoritmo capas (de menos a más data)

**Capa 1 — Calendar baseline** (día 1 de uso):
- Promedio simple de duración del ciclo
- Predicción fechas próximo período + ventana fértil

**Capa 2 — Personal learning** (después de 2-3 ciclos):
- Variance del ciclo (no asume 28 días)
- Detecta patrones de síntomas (cólicos día 1-2, antojos día 22-28)
- Ajusta predicción de mood/energía por día

**Capa 3 — Multi-señal con wearables** (con Apple Health / Oura):
- BBT (temperatura basal) → confirma ovulación
- HRV → indica fase lútea (HRV cae)
- RHR (resting HR) → sube en lútea tardía
- Sueño → empeora 3 días antes de período (insight automático)
- Steps + workout intensity de SAVIA

**Capa 4 — Hormonal state estimation** (V2):
- Modelo estima E2 y P4 estimados por día basado en fase + síntomas + biomarcadores
- No es lab-grade, es "approximate hormonal state" para personalizar coaching

### Manejo de irregularidad

PCOS, perimenopausia, postparto, anticonceptivos hormonales **invalidan el modelo simple**. SAVIA detecta:
- Si variance del ciclo > 7 días → flag "ciclo irregular", baja confidence de predicción
- Si la usuaria reporta PCOS o perimenopausia → cambia a modelo de "menstrual pattern tracking" sin predicción de fertilidad
- Anticonceptivos hormonales → tracking de síntomas sin predicción de ciclo (el cycle es artificial)

---

## 6. Integración con SAVIA (la pieza clave)

### Matriz: Fase × Módulo

| Fase | Días aprox | Nutrición | Workout | Recovery | Sleep |
|---|---|---|---|---|---|
| **Menstrual** | 1-5 | +iron (hígado, lentejas), +magnesio (cólicos), -carbs simples | Intensidad 50-70%. Mobility/yoga OK | Prioriza descanso. RHR alto esperado | -REM esperado, prioriza horario fijo |
| **Folicular** | 6-13 | Protein high, carbs OK para entreno fuerte | Strength PRs. Vigorous OK | HRV alta. Push duro | Sueño normal/excelente |
| **Ovulatoria** | 14-16 | Calories peak demand, hidratación + | Peak performance day. Test 1RM | HRV pico | Sueño 7-8h ideal |
| **Lútea temprana** | 17-22 | Protein high, carbs complejos, fiber | Endurance OK, strength baja 10% | RHR sube, HRV cae gradual | Sueño OK pero temperatura sube |
| **Lútea tardía / PMS** | 23-28 | +carbs complejos (antojos), +magnesio, -alcohol/cafeína | Intensidad -20%, foco recovery | RHR alto, HRV baja, fatiga | -REM, -deep sleep, insomnia común |

### Cómo se materializa en SAVIA

- **Balance Energético en Hoy** muestra subtle "fase lútea: +200 kcal demand esperado"
- **AI Insight diario** menciona la fase si es relevante: *"Estás en lútea tardía. Tu HRV cayó 8% — normal. Foco hoy: 30min walk + proteína alta."*
- **Plan nutricional**: si plan activo, el AI sugiere swaps según fase (ej. "tu plan dice 80g carbs, pero estás en lútea tardía — sumá 20g de avena para antojos")
- **Workout module** muestra badge "modo gentil" en días menstruales si user opted in
- **Push notifications**: 3 días antes de período predicho → "Prepará magnesio y descansá mejor esta semana"

---

## 7. AI Women's Health Coach

### Especialización vs el coach general de SAVIA

El coach general (Sprint AI próximo) responde wellness. El Women's Health Coach es una **especialización adicional** que activa SOLO si el módulo Women's Health está habilitado.

### Sistema prompt extra (encima del system prompt SAVIA Coach)

```
Eres especialista en endocrinología femenina y wellness hormonal.
Cuando la usuaria pregunta sobre energía, fatiga, antojos, mood, recovery,
sueño, fuerza o rendimiento, SIEMPRE considera primero:
1. Día del ciclo actual
2. Fase hormonal (menstrual / folicular / ovulatoria / lútea)
3. Síntomas reportados últimos 7 días
4. Patrones históricos personales

Nunca prescribas tratamientos médicos. Sugiere consulta con ginecóloga
si la pregunta toca: ciclos irregulares persistentes, dolor severo,
fertilidad, anticoncepción, condiciones diagnosticadas.

Idioma: español tico/centroamericano femenino, neutro, sin paternalismo.
Tono: amiga sabia, no doctora distante.
```

### Tools extra que el coach puede llamar

- `get_cycle_phase()` → fase actual + día + confidence
- `get_hormonal_estimate()` → E2/P4 estimados + energy_score
- `compare_phase_to_history()` → "tu HRV en lútea tardía suele caer 8%, ahora cayó 12% — más fatiga"
- `log_symptom(category, intensity)` → log directo vía conversación
- `suggest_phase_aware_swap(meal_id)` → cambio de comida según fase

### Preguntas reales que responde mejor que nadie

| Pregunta usuaria | Respuesta genérica (Flo) | Respuesta SAVIA Coach |
|---|---|---|
| "¿Por qué tengo menos energía hoy?" | "El cansancio es normal en mujeres" | "Estás en día 24 (lútea tardía). Tu HRV cayó 9% vs tu baseline. Dormiste 6.2h vs tu promedio 7.4. Foco: hidratación + 30min walk + magnesio antes de dormir." |
| "¿Por qué tengo más hambre?" | "Puede ser hormonal" | "Lútea tardía: leptina baja, P4 alta → ↑apetito. Sumá 20g carbs complejos al snack PM (avena o camote). Es normal." |
| "¿Puedo entrenar fuerte hoy?" | "Escucha tu cuerpo" | "Día 13: pico folicular. HRV alta. Es tu día. Apuntá PR en sentadilla si vas hoy al gym." |

---

## 8. Dashboard

### Pantalla "Mi Ciclo"

Diseño inspirado en Apple Watch Activity rings + Oura readiness:

```
┌──────────────────────────────────┐
│   DÍA 14 · FOLICULAR TARDÍA       │
│                                    │
│         ╭───────────╮              │
│        ╱  ENERGÍA   ╲              │
│       │     85%      │             │
│        ╲ ALTA HOY   ╱              │
│         ╰───────────╯              │
│                                    │
│  Próximo período · 14 días         │
│  Confidence: 87%                   │
│                                    │
│  ───────────────────────           │
│  HOY · LO QUE TU CICLO DICE        │
│                                    │
│  💪 Push duro en gym OK            │
│  🥩 +30g proteína vs ayer          │
│  💧 Hidratación normal             │
│  😴 Sueño debería ser bueno        │
└──────────────────────────────────┘
```

Debajo: timeline horizontal de los próximos 14 días con fase + energía esperada (heatmap), tap = forecast de ese día.

**Estética**: minimalista Aesop/Tracksmith — moss green sobre linen (consistente con SAVIA branding). Sin emojis decorativos en exceso, sin colores brillantes. Premium.

---

## 9. Motor de insights automáticos

### Architecture: pattern detector en Edge Function

Corre 1x/semana (cron) cuando la usuaria acumula >2 ciclos de data.

### Patterns que detecta

1. **Cycle-correlation symptoms**: "Tus cólicos suelen aparecer día 1-2"
2. **Sleep degradation pre-period**: "Tu sueño cae 18% los 3 días antes del período"
3. **Performance peaks**: "Tu fuerza máxima documentada cae en día 12-14"
4. **Craving patterns**: "Antojos de dulce aumentan día 22-28 consistentemente"
5. **HRV signature**: "Tu HRV se recupera 2 días después de menstruación"
6. **Recovery debt**: "Necesitás 1 día extra de recovery en lútea tardía"
7. **Hidration pattern**: "Tu retención líquida pico es día 25"

### UX delivery

- Una vez detectado, aparece como **insight card** en Hoy:
  > *"💡 Patrón detectado: tu sueño empeora 3 días antes de tu período. ¿Querés que te recordemos prepararte mejor?"*
- Toggle "activar reminder" → push notification automática
- Usuaria puede ver lista completa de insights detectados en sección "Insights" del módulo

---

## 10. Modelo de datos

### Tablas nuevas

```sql
-- Configuración del módulo Women's Health del user
women_health_profile (
  id, user_id, enabled, status (cycle_natural|hormonal_bc|pregnancy|
  postpartum|perimenopause|menopause|skipped), age, avg_cycle_length_days,
  avg_period_length_days, conditions (PCOS|endo|fibroids|...),
  hormone_therapy_jsonb, goal_primary,
  enabled_at, updated_at
)

-- Ciclos detectados/registrados
cycle_logs (
  id, user_id, cycle_number, started_at, ended_at,
  predicted_end DATE, predicted_next_start DATE,
  flow_intensity_log JSONB,  -- {day_1: 'heavy', day_2: 'medium'...}
  notes,
  is_anomaly BOOLEAN,
  source TEXT ('manual'|'predicted'|'wearable'),
  created_at, updated_at
)

-- Logs diarios de síntomas y biomarcadores
cycle_day_logs (
  id, user_id, log_date,
  cycle_id (ref cycle_logs),
  cycle_day INTEGER,  -- día del ciclo (1-N)
  predicted_phase TEXT (menstrual|follicular|ovulatory|luteal_early|luteal_late),
  flow_intensity TEXT,
  cramp_level INTEGER (0-3),
  energy_level TEXT (low|medium|high),
  mood TEXT,
  cravings TEXT[],
  symptoms_extra JSONB,
  sleep_quality_self INTEGER (1-5),
  notes,
  bbt_celsius DECIMAL,  -- de wearable o termómetro
  created_at
)

-- Estimaciones hormonales (calculadas por motor)
hormonal_state_daily (
  id, user_id, date,
  cycle_day INTEGER,
  phase TEXT,
  e2_estimated_score DECIMAL,  -- 0-100 relativo
  p4_estimated_score DECIMAL,
  energy_score DECIMAL,
  readiness_score DECIMAL,  -- 0-100, similar Oura readiness
  confidence DECIMAL,
  recommendations_jsonb JSONB,
  generated_at
)

-- Insights detectados por el motor de patterns
cycle_insights (
  id, user_id, insight_key, title, description,
  pattern_type, first_detected_at, confidence,
  user_acknowledged BOOLEAN, reminder_enabled BOOLEAN
)
```

### Cross-references con tablas existentes

- `meal_logs` ya existe → query joins con `cycle_day_logs` para pattern detection de antojos
- `workout_logs` → cross-ref para detectar pico de fuerza por fase
- `daily_logs` (sleep) → input para insight de sleep pre-period
- `wearable_connections` → si Oura/Whoop, leemos HRV, BBT, RHR diarios

### RLS
Todo `auth.uid() = user_id`. Schema B2B-ready desde día 1: agregamos `patient_user_id` + `uploaded_by_user_id` futuro para que ginecólogas vean dashboard de pacientes con consentimiento explícito.

---

## 11. Sistema de IA — Arquitectura técnica

```
┌─────────────────────────────────────────────────────────┐
│ DAILY HORMONAL STATE GENERATOR (cron 4am)              │
│ Edge Function: women-daily-state                       │
│ - Input: cycle_logs + cycle_day_logs + wearable + sleep│
│ - Output: hormonal_state_daily row                     │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ PATTERN DETECTION ENGINE (cron weekly)                 │
│ Edge Function: women-pattern-detector                  │
│ - Después de 2+ ciclos completos                       │
│ - Detecta 7 tipos de patterns                          │
│ - Insert en cycle_insights                             │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ SAVIA COACH (extended with women's health context)     │
│ Edge Function: ai-chat (sprint próximo)                │
│ - Context payload incluye hormonal_state + insights    │
│ - System prompt agrega especialización endocrinólogica │
│ - Tools agregados: get_cycle_phase, etc.               │
└─────────────────────────────────────────────────────────┘
```

### Modelo ML para predicción (V2)

- **Phase 1 (MVP)**: regla simple basada en duración promedio del ciclo + offset desde último período
- **Phase 2 (V2)**: random forest entrenado en ciclos personales + biomarcadores. Más data → mejor predicción
- **Phase 3 (V3)**: federated learning — modelo global mejora con miles de ciclos sin compartir data personal

---

## 12. Moat — Por qué esto es difícil de copiar

### 1. **Ecosystem moat**: SAVIA YA tiene nutrition, workout, sleep, recovery, plan nutricional. Construir esto desde cero toma 18 meses. Flo, Clue no lo tienen y no van a construirlo. Whoop/Oura tienen biomarkers pero NO planes/nutrición integrados.

### 2. **Data network effect**: cada mujer que usa SAVIA mejora el modelo de patterns para todas. Después de 10,000 usuarias activas, predicciones serán mejores que cualquier competidor.

### 3. **B2B integration con ginecólogas**: replica el modelo Sofía López para wellness femenino. Doctora sube plan, SAVIA lo ejecuta phase-aware. Stickiness clínica que ninguna app B2C tiene.

### 4. **Idioma + cultura**: Latam es underserved. Flo en español es traducción literal, no diseño cultural. SAVIA habla tico/spanglish premium, normalizes wellness conversation.

### 5. **Hormone-aware AI coach**: nadie hace coaching conversational que cruce cycle + nutrition + workout + recovery + sleep. Construir esto requiere TODAS las piezas del ecosistema funcionando.

### 6. **Hormonal Intelligence Engine como IP**: el algoritmo que estima E2/P4 de señales indirectas (HRV + BBT + symptoms + sleep) puede ser propietario. Patenteable.

---

## 13. Roadmap

### MVP (2-3 sprints)
- Schema + onboarding 6 preguntas + cycle log básico (1 tap por día)
- Dashboard Día/Fase/Energía
- Predicción simple (calendar-based)
- Cross-reference SOLO en AI Insight diaria ("estás en lútea, dormí bien")

### V1 (siguiente trimestre)
- Pattern detector engine — 3 patterns base
- AI Coach con context hormonal
- Integration Apple Health / Oura BBT y HRV
- Push notifications "3 días antes de tu período"

### V2 (6 meses)
- Hormonal state estimator (E2/P4 scores)
- Phase-aware meal swap suggestions (integración con plan)
- Phase-aware workout intensity suggestions
- Symptom logging avanzado con foto opcional (cólicos, sangrado)

### V3 (12 meses)
- B2B portal para ginecólogas (igual modelo nutricionistas)
- Predicción fertility window con BBT
- Embarazo / postparto modes
- Perimenopausia tracking specialized
- Marketplace de doctoras certificadas SAVIA Women's Health

---

## 14. Estrategia comercial

### Pricing

- **SAVIA Free**: wellness básico, sin Women's Health
- **SAVIA Plus** $9/mes: incluye Women's Health module + AI Coach básico
- **SAVIA Premium** $19/mes: Pattern detector + insights + integración wearable + Coach avanzado
- **SAVIA + Doctora** $39/mes: incluye plan ginecológico mensual

### Pricing comparison
- Flo Premium: $50/año (~$4.20/mes) — ads gratis pero sin coaching
- Clue Plus: $10/mes — más básica
- Natural Cycles: $99/año (~$8.30/mes) — focus contraception
- Oura ring: $300 hardware + $6/mes
- **SAVIA**: $9-19/mes pero VALOR es coaching integrado

### Go-to-market

1. **Wave 1 (CR + GT + Panamá)**: partnerships con 20 ginecólogas premium en San José/Ciudad de Guatemala/Panamá City
2. **Wave 2 (MX)**: target México wellness premium, partnership con 50 ginecólogas
3. **Wave 3 (Latam + US Hispanic)**: 1M MAU target en 24 meses

### Diferenciador para Latam específicamente
- **Sin pricing en USD**: pricing local CRC, GTQ, MXN
- **Idioma cultural real**: "lútea tardía" sí, pero también "esa semana de antes" cuando sea casual
- **Privacidad fuerte**: en Latam el embarazo/anticoncepción/aborto es sensitivo. Datos privados, encriptados, never sold. Bandera importante.
- **Integración con nutricionistas locales** (modelo Sofía López): pacientes de doctoras Latam adoptan SAVIA via prescripción

---

## 15. Estrategia de comunicación

### El reposicionamiento

Mensaje grande: **"SAVIA es para todas las fases de tu vida, no solo tu período."**

- Wellness premium **integrado** con tu ciclo
- No "app de regla", es OS de salud femenina
- Para mujeres que entrenan, trabajan, comen consciente, y quieren entender por qué su cuerpo varía

### Visual / branding

- Misma paleta SAVIA (moss green + linen)
- Para el módulo, agregar **rosa lila tenue** como acento (NO rosa pastel infantil)
- Iconografía: ningún "útero rosado" estereotipado. Más bien: círculos, flujo, anillos (como Oura)

---

## 16. Próximos pasos concretos

Si aprobás esta dirección, el orden de ejecución sería:

| Paso | Acción | Tiempo |
|---|---|---|
| 1 | **Validar visión** con 5-10 mujeres target (founders, pro athletes, busy professionals) | 1 sesión investigación |
| 2 | **Schema SQL** (women_health_profile, cycle_logs, cycle_day_logs, hormonal_state_daily, cycle_insights) | 1 sesión |
| 3 | **Onboarding 6 pantallas** (skipeable, < 2 min) | 1 sesión |
| 4 | **CycleLog 1-tap** + Dashboard "Mi Ciclo" v1 | 1 sesión |
| 5 | **Predictor simple** (calendar-based, suficiente para MVP) | 1 sesión |
| 6 | **Hormonal context** en AI Insight diaria (ya existente) | 0.5 sesión |
| 7 | **Daily state generator** (cron) | 1 sesión |
| 8 | **Integración wearable BBT/HRV** (Apple Health, Oura) | 2 sesiones |
| 9 | **Pattern detector v1** (3 patterns clave) | 1 sesión |
| 10 | **Coach especialización Women's Health** | (parte del Sprint AI Coach) |

**Total a MVP completo: ~7-8 sesiones de código.**

---

## 17. La gran pregunta

Este módulo, si lo hacés bien, puede **duplicar el TAM de SAVIA** (51% de la población). Pero requiere **convicción sobre branding** y disciplina para no copiar Flo.

**Mi recomendación: empezamos por validar con 5-10 mujeres target** antes de codear. 30 minutos de cada una vale más que 30 horas de código a ciegas.

Si decidís arrancar el código, el orden propuesto está arriba.

---

*Este documento es un blueprint estratégico, no specs técnicas finales. Cada sección se materializa en specs detalladas + mockups antes de codear.*
