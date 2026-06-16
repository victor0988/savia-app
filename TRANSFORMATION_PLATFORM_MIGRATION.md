# SAVIA — Transformation Platform Migration

**Documento de migración estratégica · v1 · 15 jun 2026**

Este documento es el punto de retorno seguro para evaluar (y revertir) la transición de SAVIA desde "app de nutrición" hacia "plataforma modular de transformación personal". No describe implementación. Describe estado, diferencias y plan de rollback.

---

## 0 · Estado de branches

| Branch | Propósito | HEAD |
|---|---|---|
| `main` | Producción actual | `13cf14b` Theme Sage & cream aplicado |
| `backup/pre-transformation-platform` | Snapshot inmutable del estado producción al iniciar la migración | `13cf14b` (igual a main) |
| `feature/savia-transformation-platform` | Workspace de la migración | `13cf14b` + cambios incrementales |

**Garantía de rollback:** mientras `backup/pre-transformation-platform` exista, podés revertir cualquier cambio del nuevo branch sin pérdida.

---

## 1 · Estado actual del producto (snapshot 15 jun 2026)

### 1.1 — Identidad

SAVIA es hoy una **app de nutrición + composición corporal con coach AI**. El branding emergente (post-theme migration) es wellness (cream + sage). Tag línea actual: *"Tu cuerpo, entendido"*.

### 1.2 — Stack y arquitectura

- **Frontend:** single-file `onboarding.html` (21.305 líneas) — HTML + CSS + JS vanilla. Deploy en Vercel (usesavia.com).
- **Auth:** Supabase Auth con Google OAuth + Email OTP. Modal de consent post-login.
- **Backend:** Supabase (Postgres + RLS + Edge Functions).
- **AI:** Anthropic Claude (Sonnet 4.5) vía Edge Function `ai-chat-stream`.
- **Wearables:** Strava (workouts), InBody (composition uploads).

### 1.3 — Pantallas existentes (62 screens en `onboarding.html`)

Agrupadas funcionalmente:

| Grupo | Screens | Función |
|---|---|---|
| Auth | `auth`, `signup`, `login`, `otp-email`, `otp-verify`, `verify`, `change-password`, `forgot` | Login + signup passwordless |
| Onboarding | `0`–`8`, `2.4`, `2.5` | Captura inicial (nombre, sexo, edad, objetivos) |
| App home | `app` | Hoy + tabs internas (hoy, coach, profile, progress) |
| Nutrición | `nutrition`, `nut-log`, `nut-meal-method`, `nut-meal-edit`, `nut-meal-edit-portion`, `nut-search`, `nut-photo-analyzing`, `nut-photo-result`, `nut-barcode-scan`, `nut-barcode-result`, `nut-edit-macros`, `nut-targets-compare`, `nut-results`, `nut-onb-1/2/3/4`, `nut-onb-conflict`, `nut-inbody-analyzing`, `nut-inbody-confirm` | Log de comidas + plan + InBody |
| Plan nutricionista | `plan-analyzing`, `plan-confirm`, `plan-when`, `plan-when-date`, `plan-meal-log`, `plan-today`, `plan-upload-method`, `plan-view` | Plan prescrito de Sofía López (nutricionista) |
| Transformation Chapters | `progress`, `chapter-viewer` | Tu Progreso + biblioteca de capítulos |
| Workouts | `workout`, `wk-log`, `strava-callback` | Strava integration + log manual |
| Women's Health | `wh-dashboard`, `wh-quicklog`, `wh-onb-1/2/3/4/5/6` | Ciclo menstrual (módulo opcional) |
| Coach | `coach-chat` | Conversación con SAVIA AI |
| Daily log | `daily-log` | Registro emocional rápido |
| Profile | `profile` | Configuración cuenta |

### 1.4 — Navegación actual

Bottom tabbar dentro del screen `app`: **Hoy / Coach / Progress / Profile** (4 tabs, color activo `#5C7C5A`).

Todos los flujos de nutrición/plan/wh/workout abren como overlays full-screen sobre el `app` screen actual.

### 1.5 — Schema de base de datos (`SAVIA_*.sql` + otros)

| Schema | Tablas principales | Estado |
|---|---|---|
| `profiles` (Supabase Auth) | `id`, `email`, `name`, `sex`, `dob`, `goals`, `terms_accepted_at`, `terms_version` | Producción |
| `SAVIA_NUTRITION_SCHEMA.sql` | `nutritional_targets`, `meal_logs`, `food_items` | Producción |
| `SAVIA_BODY_COMPOSITIONS.sql` | `body_compositions` (InBody snapshots) | Producción |
| `SAVIA_DAILY_LOGS.sql` | `daily_logs` (mood, hydration, etc.) | Producción |
| `SAVIA_MEAL_PLANS.sql` | `meal_plans`, `meal_plan_items`, `meal_plan_logs` | Producción |
| `SAVIA_WEARABLES.sql` | `strava_connections`, `strava_activities` | Producción |
| `SAVIA_WORKOUTS.sql` | `workout_logs` | Producción |
| `coach-schema.sql` | `coach_messages`, `coach_conversations` | Producción |
| `health-twin-schema.sql` | `user_health_twin`, `user_behavioral_summary`, `coach_memories` (vector) | Producción |
| `transformation-chapters-schema.sql` | `transformation_chapters` (polimórfico vía `source_type`) | Producción |
| `savia-pulse-schema.sql` + `migration-002` | `daily_pulses` (insights diarios) | Producción |
| `notes-schema.sql` | `user_notes` | Producción |
| `user-events-schema.sql` | `user_events` (telemetría) | Producción |
| `women-health-schema.sql` + `migration-001` | `women_health_profiles`, `cycle_day_logs` | Producción |
| `profiles-terms-consent.sql` | columnas `terms_accepted_at`, `terms_version` en profiles | Producción |

### 1.6 — Edge Functions activas

- `ai-chat-stream` — streaming coach conversation
- `ai-daily-insight` — generación de Daily Pulse
- `analyze-food-image` — Vision API para fotos de comida
- `generate-savia-pulse` — pulse cards de Hoy
- `generate-transformation-chapter` — narración de capítulos (InBody y futuros)
- `parse-inbody-document` — OCR de PDFs InBody
- `parse-meal-plan` — parse de planes de nutricionista
- `search-food` — búsqueda en base de alimentos
- `strava-oauth-callback` — OAuth Strava
- `strava-sync-activities` — sync workouts
- `track-event` — telemetría

### 1.7 — Documentos de arquitectura existentes

- `SAVIA_HEALTH_TWIN_ARCHITECTURE.md` — capa de memoria del coach (4 capas)
- `SAVIA_PULSE_INSIGHT_DESIGN.md` — diseño de insights diarios
- `SAVIA_WOMENS_HEALTH_BLUEPRINT.md` — módulo women's health
- `SAVIA_ROADMAP.md` — roadmap previo
- `SAVIA_QA_CHECKLIST.md` — QA pre-push
- `RELATIONSHIP_LAYER_ROLLBACK.md` — historial de un pivot anterior (coach layer)
- `AGENTS.md` — brief original del proyecto (longevidad, biohacking — **desactualizado vs nueva dirección**)

---

## 2 · Arquitectura actual (resumen)

```
USUARIO
  ↓
onboarding.html (single-page app)
  ├── Auth (Supabase Auth + Google/Email OTP)
  ├── Consent modal (post-auth, idempotente)
  ├── Onboarding nutricional (sex, age, goals, InBody)
  └── App (hoy-tabbar: Hoy | Coach | Progreso | Perfil)
       ├── Hoy: Daily Pulse + Tu Plan card + Cycle card
       ├── Coach: chat con AI (Sonnet 4.5)
       ├── Progreso: Tu Progreso pillar + biblioteca de capítulos
       └── Perfil: settings + cuenta

SUPABASE
  ├── Auth (Google + Email OTP, JWT ES256)
  ├── Postgres
  │   ├── profiles (auth.users + custom cols)
  │   ├── nutritional_targets, meal_logs, body_compositions, daily_logs
  │   ├── meal_plans, meal_plan_items, meal_plan_logs
  │   ├── strava_*, workout_logs
  │   ├── coach_messages, coach_memories (vector), user_health_twin
  │   ├── transformation_chapters (polimórfico via source_type)
  │   ├── daily_pulses, user_notes, user_events
  │   └── women_health_*
  ├── Storage (food_photos, inbody_uploads, chapter_media)
  └── Edge Functions (12 listadas arriba)

EXTERNAL
  ├── Anthropic Claude API (Sonnet 4.5)
  ├── Strava OAuth + Activities API
  └── Vercel hosting
```

---

## 3 · Nueva visión propuesta (Transformation Platform)

### 3.1 — Cambio de identidad

| Antes | Después |
|---|---|
| App de nutrición + coach | Plataforma modular de transformación |
| 1 vertical (nutrición + composición) | N módulos: Nutrición, Estética, GLP-1, Longevidad, Fitness |
| B2C wellness | B2B2C (clínicas prescriben, pacientes ejecutan) |
| "Tu cuerpo, entendido" | *(por definir — orientado a transformación)* |

### 3.2 — Nueva navegación propuesta

5 tabs en bottom nav:

1. **Mi Progreso** (landing) — Hero + Tu Evolución + Tu Historia (capítulos) + Energía & Recuperación + Insight SAVIA + Próximos Hitos
2. **Plan** — módulos activos como tarjetas paralelas con acciones del día
3. **Capturar** — centro de evidencia (foto, selfie, InBody, lab, peso, medición, nota)
4. **SAVIA** — chat
5. **Perfil** — settings, conexiones (Oura/Strava/Apple Health), clínica, módulos habilitados

### 3.3 — Nuevos conceptos arquitectónicos

- **Módulos** como configuración de un paciente (nutrición/estética/GLP-1/longevidad/fitness)
- **Pilares de transformación** (concepto interno) — composición / energía / estética visible / performance / bienestar interno
- **Practitioners** (médicos/clínicas) que prescriben protocolos
- **Patient-cohort benchmarks** ("vas mejor que 80%")
- **Multi-protocol concurrent** — un paciente puede tener nutrición + GLP-1 + facial simultáneamente
- **Module-aware coach** — el coach habla en glosario del protocolo activo

---

## 4 · Gap análisis: actual vs propuesta

### 4.1 — Lo que YA EXISTE y se reutiliza tal cual

✅ **Auth + consent** (Supabase Auth, Google OAuth, Email OTP, modal post-login)
✅ **Sistema de capítulos** (`transformation_chapters` polimórfico via `source_type`)
✅ **Coach AI** (Health Twin + memorias vectoriales + ai-chat-stream)
✅ **Daily Pulse** (savia-pulse-schema + generate-savia-pulse)
✅ **Profile + perfil** (Supabase `profiles`)
✅ **Daily logs** (mood, hydration, etc.)
✅ **InBody flow** (parse-inbody-document + body_compositions + chapter generation)
✅ **Meal logging** + food search + photo analysis
✅ **Meal plans** (nutricionista prescribe)
✅ **Strava integration**
✅ **Women's Health module** (precedente del patrón "módulo activable")
✅ **Theme Sage & cream**

### 4.2 — Lo que NECESITA EXTENSIÓN (no reemplazo)

🔧 **Bottom nav** — de 4 tabs internas a 5 tabs estructurales (afecta layout pero no destruye)
🔧 **`transformation_chapters.source_type`** — agregar valores: `aesthetic_photo`, `treatment_session`, `lab_result`
🔧 **`profiles`** — agregar relación a `practitioners` + array `active_modules`
🔧 **Daily Pulse** — generación condicionada por módulos activos
🔧 **Coach system prompt** — capa de glosario según módulos
🔧 **Hoy / Mi Progreso** — agregar Tu Evolución + Próximos Hitos + Energía & Recuperación

### 4.3 — Lo que es COMPLETAMENTE NUEVO (a construir)

🆕 **`treatment_protocols` table** — protocolos activos por paciente con tipo (nutrición/GLP-1/facial/láser/etc.) y `prescribed_by_practitioner_id`
🆕 **`practitioners` table** — médicos/clínicas que prescriben
🆕 **"Capturar" como destino** — actualmente la captura es action contextual, se vuelve tab principal
🆕 **Patient-cohort benchmarks** — agregación poblacional ("vas mejor que 80%")
🆕 **Oura / Apple Health integrations** — actualmente solo Strava
🆕 **Aesthetic photo flow** — fotos clínicas con guía de pose (frontal, lateral, cara)
🆕 **B2B panel para clínicas** — fuera del scope de esta fase

### 4.4 — Lo que se MANTIENE INTACTO (no se toca)

🛡️ **Nutrición completa** (meal logs, planes, búsqueda, foto analysis)
🛡️ **InBody flow** end-to-end
🛡️ **Coach conversacional + Health Twin**
🛡️ **Women's Health module**
🛡️ **Strava + workouts**
🛡️ **Auth + consent + privacy**
🛡️ **Edge Functions actuales**
🛡️ **Schemas SQL actuales** (solo se extienden, no se borran)

---

## 5 · Estrategia de migración

Cinco fases incrementales, cada una con su propio merge a `main` o rollback:

### Fase A — Mockup navegable (**actual, en feature branch**)
- Output: `savia-transformation-mockup.html` (standalone, datos mock)
- Validar UX antes de tocar arquitectura real
- Cero riesgo de producción

### Fase B — Schema extensions (futura)
- Agregar `practitioners`, `treatment_protocols`
- Extender `transformation_chapters.source_type` con nuevos valores
- Agregar `profiles.active_modules`, `profiles.practitioner_id`
- Migración aditiva (no destructiva)

### Fase C — Reorganización de navegación (futura)
- Convertir hoy-tabbar de 4 tabs a 5 (Mi Progreso, Plan, Capturar, SAVIA, Perfil)
- Renombrar y reorganizar contenido existente sin perder funcionalidad
- Mantener compatibilidad con flujos actuales

### Fase D — Nuevos flujos: Capturar + Aesthetic photo (futura)
- Implementar destino Capturar real
- Implementar captura de fotos clínicas con guía de pose
- Conectar con `transformation_chapters` extendidos

### Fase E — Multi-protocol display + practitioners (futura)
- Implementar Plan con N módulos paralelos
- UI para vincular paciente a clínica/practitioner
- Coach con glosario adaptativo

---

## 6 · Plan de rollback

### 6.1 — Rollback total al estado pre-migración

```bash
cd "/Users/victor.lacayo/Documents/Claude/Projects/App de Peptidos"
# Volver a main sin perder cambios locales
git checkout main
# Si querés borrar feature branch:
git branch -D feature/savia-transformation-platform
# Backup branch permanece intacto como safety net
```

### 6.2 — Rollback parcial (solo descartar mockup)

```bash
git checkout feature/savia-transformation-platform
git rm savia-transformation-mockup.html
git commit -m "Revert: descartar mockup de transformation platform"
```

### 6.3 — Rollback de fase específica (futuro)

Cada fase B/C/D/E debe ir en su propio commit con prefijo `migration-phase-X:` para revertir con `git revert <commit>` sin afectar fases anteriores ya validadas.

### 6.4 — Rollback de schema (si se ejecutan migraciones en Fase B+)

Cada migration nueva debe incluir un `down.sql` con el rollback exacto. Convención: `transformation-platform-NNN-name.sql` + `transformation-platform-NNN-name.rollback.sql`.

### 6.5 — Punto de no retorno

El primer push a `main` con la nueva navegación (Fase C) es el punto crítico. Antes de ese merge:
- `backup/pre-transformation-platform` debe estar pushed al remote
- QA full + beta test con María (primera usuaria real) debe pasar
- Si falla, se hace `git revert <merge commit>` sin más complicación

---

## 7 · Riesgos identificados

### Alto
- **Confusión de identidad de marca** — pasar de "app de nutrición" a "plataforma modular" puede diluir el mensaje en marketing
- **Sobre-ingeniería pre-validación** — construir B2B antes de validar B2C con María
- **Inconsistencia coach** — el system prompt actual no contempla módulos, riesgo de respuestas confusas si no se actualiza junto

### Medio
- **Theme regression** — la migración Sage & cream tomó esfuerzo significativo; cambios estructurales pueden re-introducir bugs visuales
- **Breaking change para users beta** — María/Mari ya usan SAVIA con la nav actual
- **Documentación desactualizada** — `AGENTS.md` y `SAVIA_ROADMAP.md` apuntan al pivot anterior

### Bajo
- **Performance** — agregar más data al landing (Mi Progreso) puede impactar cold start
- **Compatibilidad iOS** — bottom nav con 5 tabs puede ser ajustado vs 4

---

## 8 · Decisiones diferidas

Estas decisiones no se toman en esta fase del backup. Quedan documentadas para la futura fase de implementación:

- Nombre de marca: ¿se mantiene SAVIA o se evoluciona?
- Pricing model B2B (clínica paga por seat) vs B2C (paciente paga directo)
- ¿Cuántos módulos lanzar en MVP? (recomendación: solo Nutrición + Estética inicialmente)
- ¿White-label vs co-branding para clínicas?
- ¿Cuál es la primera clínica piloto B2B?

---

## 9 · Próximos artefactos en este branch

| Artefacto | Estado | Notas |
|---|---|---|
| `TRANSFORMATION_PLATFORM_MIGRATION.md` | ✅ este documento | Punto de retorno |
| `savia-transformation-mockup.html` | 🚧 en construcción | Mockup navegable Fase A |
| Decisiones UX documentadas | 🚧 en respuesta del agente | Acompañan al mockup |

---

*Fin del documento. Última actualización: 15 jun 2026. Owner: Victor Lacayo.*
