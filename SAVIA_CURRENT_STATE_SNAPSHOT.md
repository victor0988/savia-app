# SAVIA · Snapshot del Estado Actual (pre-pivote aesthetic)

**Fecha**: 2026-06-16
**Branch backup**: `backup-nutrition-mvp` (creado para preservar este estado)
**Commit de referencia**: ver `git log --oneline -1` en branch `backup-nutrition-mvp`

---

## Por qué este documento existe

Antes del pivote estratégico hacia "OS para clínicas estéticas", SAVIA fue construida y validada como plataforma de nutrición + body composition + wellness. Esa versión sigue siendo extremadamente valiosa para nutricionistas y clínicas funcionales/longevidad/GLP-1. Este documento captura ese producto para que pueda:

1. Volverse a activar como modo "nutrición" en el futuro
2. Servir como white-label específico para nutricionistas independientes
3. Usarse como rollback rápido si el pivote estético no resuena

**Cero pérdida de producto actual. Cero destrucción de trabajo previo.**

---

## Arquitectura técnica actual

### Stack
- **Frontend**: single-file SPA en `onboarding.html` (~24k líneas, HTML/CSS/JS vanilla, sin build step)
- **Backend**: Supabase (Postgres + Edge Functions Deno)
- **Auth**: Supabase Auth (Google OAuth + email/password)
- **AI**: Anthropic Claude (Haiku 4.5 para coach + insights; Sonnet 4.6 reservado para tasks complejos)
- **Storage**: Supabase Storage (fotos InBody, imágenes paciente)
- **Hosting**: Vercel (usesavia.com)
- **Wearables**: Strava (OAuth + sync activities), Apple Health (HealthKit)
- **Compliance**: HIPAA en roadmap (no actualmente), GDPR baseline

### Edge Functions productivas
- `ai-chat-stream` — Coach SAVIA conversacional con tools (log_meal, log_water, log_workout, get_balance, etc.)
- `generate-savia-pulse` — Insights generados por IA con 8 categorías (recovery, nutrition, training_prep, post_workout, behavioral, body_comp, hormonal, transformation_arc)
- `strava-oauth-callback` + `strava-sync-activities` — Integración Strava
- `parse-meal-plan` — Parsea PDF de plan nutricional con Claude Vision
- `ai-daily-insight` — Legacy (pre-pulse)

### Tablas Supabase principales
- `user_profiles`, `user_health_twin`, `nutrition_targets`, `daily_logs`
- `meal_logs`, `hydration_logs`, `workout_logs`
- `body_compositions`, `inbody_records`
- `coach_threads`, `coach_messages`
- `savia_pulses`
- `transformation_chapters`
- `women_health_profile`, `cycle_day_logs`
- `meal_plans`
- `wearable_connections`
- `practitioners` (médicos / clínicas)

---

## Pantallas actuales (vista v=2, ?v=2)

### Tab 1 — Mi Progreso (default)
1. Hero compacto (avatar + nombre + semana)
2. WH cycle pill (si aplica)
3. TU DÍA: Balance Energético HOY + 4 Pillars (workout/pasos/sueño/agua) + Daily Pulse
4. Cards demo aesthetic: Skincare detail + Próximas Dosis (si toggle ON)
5. Tu Evolución (fotos before/after + delta InBody)
6. Transformation Reel (5 cards autogeneradas)
7. Insight SAVIA (savia_pulse activo)
8. Tus Números (4 KPIs: días, peso, body fat, workouts)

### Tab 2 — Plan
- Cards de módulos activos: Nutrición (con prescripción + tracking), GLP-1, Estética (PRP/Sculptra), Skincare
- En modo demo aesthetic: cards reales de protocolos

### Tab 3 — Capturar
- 8 tiles para evidencia: Capítulo / InBody / Peso / Foto / Comida / Workout / Síntoma / Sueño

### Tab 4 — Coach
- Chat conversacional con SAVIA (Haiku)
- Tool calling para registrar comidas/agua/workouts/peso desde lenguaje natural
- Sliding window MAX_HISTORY=4
- Insight transformation_arc (Identity + Trajectory templates)

### Tab 5 — Perfil
- Equipo médico (mock + Sofía López como nutricionista actual)
- Módulos activos
- Conexiones (Strava, Apple Health, InBody)
- Toggle demo aesthetic

---

## Features completas y funcionando

✅ Onboarding multi-paso (sexo, edad, objetivos, peso, body fat, método)
✅ Cálculo de targets nutricionales (Mifflin-St Jeor + ajuste por objetivo)
✅ Log de comidas: manual / foto AI (Claude Vision) / barcode scan / búsqueda OpenFoodFacts
✅ Log de agua con quick-add + undo
✅ Log de workouts manual + sync Strava
✅ InBody upload PDF/foto → Claude Vision → guardar body_composition
✅ Plan nutricional: subir PDF → parse-meal-plan EF → estructura por días/comidas
✅ Coach SAVIA conversacional con tools
✅ Savia Pulse (8 categorías de insight)
✅ Transformation chapters (capítulos autogenerados de evolución)
✅ Women's Health (ciclo menstrual + fases + log diario)
✅ Sage & cream theme premium
✅ Sistema feature flag v=2 (5 tabs, default = legacy "Hoy")
✅ Modo demo aesthetic (toggle Perfil)
✅ Privacy policy + Terms + Consent flow (compliance baseline)

---

## Usuarios beta actuales (preservar experiencia)

- **María** — paciente nutricional con plan Sofía López, primera usuaria real
- **Sofía López** — nutricionista, partner clínico
- Otros pacientes en pipeline

**Estos usuarios NO deben ver el cambio aesthetic**. La versión actual sigue siendo la default hasta validar la nueva visión con clínicas estéticas beta.

---

## Estado de QA

- 75+ tasks completadas en la sesión actual
- QA agents corridos en cada cambio mayor (>30 líneas o auth/UX/routing)
- Memory persistente con anti-patterns aprendidos (slang prohibido, debug data layer first, ASK before fixing)

---

## Cómo volver a este estado si el pivote falla

```bash
# Desde main, volver al snapshot:
git checkout main
git reset --hard backup-nutrition-mvp
git push origin main --force
```

(Forzar push solo si no hay collaborators activos en main. Si los hay, hacer revert commit-by-commit del pivote.)
