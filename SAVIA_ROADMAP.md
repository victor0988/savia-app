# SAVIA — Strategic Roadmap

**Versión**: 1.0 · **Fecha**: 2026-05-31 · **Estado**: Aprobado por el founder

> Documento vivo. Cuando cambien decisiones, actualizar este archivo y bumpear la versión.

---

## Visión

SAVIA es un **AI Wellness Operating System** mobile-first que combina ciclo + workout + nutrición + sleep + recovery + (eventualmente) péptidos en una experiencia premium, minimalista y científicamente seria.

**Estética**: dark mode + verde, comparable a Whoop / Oura / Apple Health / Levels, pero más simple.

**Diferenciador**: cross-module correlations que apps individuales no pueden dar.

---

## Principios de producto (no negociables)

1. **Wearable > Manual**: si tenemos data del sensor, no se la pedimos al user
2. **AI como enabler, no autoridad**: cálculos genéricos basados en ciencia con disclaimer honesto ("genérico, busca profesional para especialización")
3. **Foto > Formulario**: cuando se puede reemplazar texto con CV, lo hacemos
4. **Cross-module correlations**: ciclo afecta workout, sleep afecta readiness, nutrition afecta recovery
5. **Privacy first**: especialmente en cycle data (post-Roe). Anonymous mode, delete account, no third-party trackers

---

## Stack y arquitectura

- **Frontend**: HTML/CSS/JS vanilla single-file (`onboarding.html`) → eventualmente Capacitor para wrap nativo iOS/Android
- **Backend**: Supabase (Postgres + Auth + Edge Functions + Storage)
- **Auth**: Google OAuth + Email OTP + Face ID (WebAuthn). Apple Sign In en backlog hasta tener Developer Account
- **Email**: Resend (transaccional) via SMTP en Supabase Auth + Edge Function para welcome
- **Dominio**: usesavia.com (www como primary via Vercel)
- **Hosting**: Vercel (auto-deploy desde GitHub)
- **AI**: Claude API via Edge Functions (server-side keys) para computer vision (nutrition photo) + chat (Ask SAVIA)
- **Wearables**: priorizar Apple HealthKit + Whoop API + Oura API + Strava + Garmin (cuando esté Capacitor wrap)

---

## Estructura de información (dashboard "Hoy")

```
TOPBAR (avatar + greeting + calibration pill)
─────────────────────
HERO: Check-in del día (PROMINENTE)
─────────────────────
Recovery / Readiness (full width)
Workout · Sleep (2-col)
Nutrition (full width, photo input)
Women's Health (si state.sex === 'f', full width)
Stack péptidos (cuando aplique, full width)
─────────────────────
TAB BAR: Hoy · Cuerpo · SAVIA (chat) · Perfil
```

---

## Decisiones de producto por módulo

### Check-in
- **Now**: input manual (mood, energy, sleep_quality)
- **Future state**: wearable autocompleta sleep_quality + HRV. User solo ajusta mood/energy
- **Hero del dashboard**, no botón secundario

### Recovery / Readiness
- **Now**: score basado en check-ins
- **Future state**: composite real de HRV + sleep stages + strain + mood histórico + ciclo + adherencia péptidos
- **Pilar técnico** que demuestra que SAVIA entiende correlaciones

### Workout
- **NO sugerencia automática por defecto**
- **Dual mode** (user elige):
  - **A) Tracking**: user entra su propia rutina, SAVIA logea
  - **B) Generar plan**: SAVIA crea plan diario O mensual (user elige granularidad) basado en literatura científica + objetivo del user
- **Premium quality**: rutinas serias, con disclaimer "genérico, busca profesional para especialización"

### Nutrition
- **Inputs**:
  - Manual: dieta + body composition
  - Calculado: body scan + inputs → SAVIA estima targets con Mifflin-St Jeor + protein per kg + objetivo
- **Tracking de comida**: foto → AI computer vision → macros aproximados → user confirma
- **Display**: ingerido vs target vs gasto calórico (de wearables/Strava)
- **Filosofía**: "menos inputs, más inteligencia"

### Women's Health (PROMOVIDO - oportunidad de mercado)
- **Tier 1 (MVP)**:
  - Calendar ring circular (fase actual highlighted)
  - Phase indicator + microcopy educacional
  - Period log 1-tap
  - Symptom tracker rápido (chips: cólicos, mood, energía, libido, sueño, bloating, dolor de cabeza, sensibilidad mamaria)
  - Cross-module insights (luteal → ajusta workout/nutrición/sleep)
  - **Privacy first prominente** (anonymous mode, delete, no third-party)
- **Tier 2 (con wearables)**:
  - Temperature-based prediction (Oura, Apple Watch S8+)
  - HRV correlation con ciclo (Whoop, Oura)
  - Cycle-synced workout adaptation automática
- **Tier 3 (post-MVP)**: pregnancy mode, fertility/TTC, partner mode, PDF export gineco
- **Diseño**: pink (#EC4899) solo como accent (dots, día actual), nunca dominante. Copy empoderada/educativa, NO infantilizada.

### Péptidos
- **BACKLOG por ahora** (después de validar wellness core)
- **Future vision**: doble target B2C + B2B (clínicas estéticas), arquitectura multi-tenant cuando aparezca primera clínica interesada

### Ask SAVIA (chat)
- Backlog hasta tener data interesante que mostrar al user
- Eventualmente: Claude API via Edge Function, context-aware (lee profile + último check-in + recent signals)

---

## Sprint plan (post-auth/onboarding ya completo)

| Sprint | Tema | Días | Status |
|---|---|---|---|
| 0 | Foundation: refactor Hoy con bento + hero check-in + tab bar + calibrando como pill | 1-2 | 📋 Next |
| 1 | Check-in real funcional + WQ computation simple | 2 | 📋 |
| 2 | Recovery module (con empty state para no-wearable) | 3 | 📋 |
| 3 | Sleep display + Workout dual mode (tracking + generador) | 4-5 | 📋 |
| 4 | Nutrition con AI vision (Claude CV) + targets calculados | 5-7 | 📋 |
| 5 | Women's Health Tier 1 (cycle + phase + symptoms + cross-insights) | 4-5 | 📋 |
| 6 | Capacitor wrap → desbloquea HealthKit → Tier 2 Women's Health + Recovery real + Sleep real | 3-5 | 📋 |
| Backlog | Stack péptidos · Ask SAVIA chat · Pregnancy/TTC modes | — | 📋 |

**Total estimado para MVP completo**: ~25-30 días de iteraciones.

---

## Schema backend (proyectado)

```sql
-- Existente
profiles (id, email, name, sex, age, goals, level, wearables, photo_url, is_onboarded)

-- Nuevo (en orden de implementación)
check_ins (id, user_id, ts, mood, energy, sleep_quality, source)
wellness_signals (id, user_id, ts, signal_type, value, unit, source)  -- HRV, sleep stages, steps, etc.
workouts (id, user_id, ts, type, duration_min, intensity, calories, source, plan_id NULL)
workout_plans (id, user_id, mode 'daily'|'monthly', start_date, plan_json, scientific_refs)
nutrition_targets (id, user_id, kcal, protein_g, carbs_g, fat_g, computed_at, formula)
nutrition_logs (id, user_id, ts, food_name, kcal, protein_g, carbs_g, fat_g, source, photo_url)
hydration_logs (id, user_id, ts, ml)
cycle_logs (id, user_id, ts, phase, period_day, symptoms[], notes, source 'manual'|'wearable')
peptide_protocols (id, user_id_or_clinic_id, peptide_name, schedule_json, start, end, active)
peptide_doses (id, user_id, ts, protocol_id, status 'taken'|'missed'|'scheduled')
ai_insights (id, user_id, ts, kind, content, source_signals[], dismissed_at)
```

---

## Decisiones explícitamente diferidas

- Apple Sign In → esperando Apple Developer Program ($99/año), no priority
- App Store distribution → requiere Apple Developer Program
- Stack péptidos B2B (multi-tenant clínicas) → después de validar B2C
- IA conversacional ("Ask SAVIA") → después de tener data rica
- Email magic link (vs OTP) → ya en uso OTP, no cambiar

---

## Changelog

- **v1.0 (2026-05-31)**: roadmap inicial post-audit completa. Decisiones: workout dual mode, péptidos diferidos, women's health promovido a sprint 5.
