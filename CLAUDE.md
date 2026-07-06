# CLAUDE.md — SAVIA

Guía de contexto para trabajar en este repo. Léelo antes de tocar código o schema.

## 1. Contexto de negocio

**SAVIA no es una app de nutrición/tracking.** Es una capa de inteligencia personal de
transformación humana (microsolución **MS002 — SAVIA Nutrición**). Su trabajo es responder,
con la data del propio usuario: ¿por qué estoy cambiando?, ¿qué hábitos producen mis
resultados?, ¿qué debería decidir esta semana?

Principios que gobiernan cualquier decisión de producto o diseño de dato:

- **Los resultados son la fuente de verdad**, no los inputs. Composición corporal (InBody),
  grasa, músculo, perímetros, biomarcadores y fotos son el ancla. Peso/calorías/macros NO son
  la métrica principal.
- **Las variables explican, no se observan.** Nutrición, sueño, pasos, entrenamiento existen
  para explicar los resultados — nunca son pantallas protagonistas por sí solas.
- **Pregunta rectora de cualquier feature:** ¿cómo está cambiando esta persona, y por qué?
- **Honestidad estadística:** correlación no es causalidad; toda relación mostrada debe llevar
  su nivel de confianza; nunca sobre-afirmar.
- **n-of-1 primero:** lo que importa es qué explica LOS resultados de ese usuario, no el
  promedio poblacional.

Fuente extendida: [`SAVIA_BRD_v2_Transformacion.docx`](SAVIA_BRD_v2_Transformacion.docx) (BRD
completo) y [`docs/BRD.md`](docs/BRD.md) (resumen ejecutivo). Contexto operativo de sesión y
estado actual: [`docs/CONTEXT.md`](docs/CONTEXT.md). Decisiones registradas:
[`docs/DECISIONS.md`](docs/DECISIONS.md).

**Alcance de este repo (importante):** `savia-app` contiene artefactos de **dos
microsoluciones separadas**: SAVIA Nutrición (nutrición, composición corporal, salud
metabólica, GLP-1 companion, Women's Health — lo activo, en beta) y un track de "OS para
clínicas estéticas" (PRP, Sculptra, skincare) que quedó de un pivote revertido y está **fuera
de alcance** de MS002. No mezclar ambos al proponer cambios; ver
`SAVIA_CURRENT_STATE_SNAPSHOT.md` para el snapshot pre-pivote y `docs/DECISIONS.md` para el
registro de la separación.

## 2. Arquitectura de datos

No hay framework ni build step: SPA de un solo archivo + Supabase. Sin `src/`, sin
`package.json`.

```
onboarding.html          → SPA completo (frontend, ~25k líneas, vanilla HTML/CSS/JS)
supabase/functions/*/    → backend real (edge functions Deno)
*.sql (raíz)             → schema real (scripts idempotentes, NO hay migrations/)
supabase-edge-*.ts       → copias de staging de las edge functions, se despliegan a supabase/functions/
```

### Modelo de datos (por dominio)

| Dominio | Archivo SQL | Tablas clave |
|---|---|---|
| Resultados (ancla) | `SAVIA_BODY_COMPOSITIONS.sql` | `body_compositions` (patient_user_id ≠ uploaded_by_user_id, B2B-ready) |
| Nutrición | `SAVIA_NUTRITION_SCHEMA.sql` | `nutrition_targets`, `meal_logs`, `hydration_logs` |
| Logs diarios (pre-wearable) | `SAVIA_DAILY_LOGS.sql` | `daily_logs` |
| Planes nutricionales | `SAVIA_MEAL_PLANS.sql` | `meal_plans`, `plan_meals`, `plan_meal_items`, `plan_supplements`, `plan_rules` |
| Entrenamiento | `SAVIA_WORKOUTS.sql` | `workout_logs` |
| Wearables | `SAVIA_WEARABLES.sql` | `wearable_connections`, `wearable_sync_log` |
| Coach IA | `coach-schema.sql` | `coach_threads`, `coach_messages` |
| Insight hero | `savia-pulse-schema.sql` + `savia-pulse-migration-002-pulse-type.sql` | `savia_pulses` (+ `pulse_type`) |
| Transformación | `transformation-chapters-schema.sql` | `transformation_chapters` |
| Women's Health | `women-health-schema.sql` + `women-health-migration-001-multi-goals.sql` | `women_health_profile`, `cycle_logs`, `cycle_day_logs`, `hormonal_state_daily`, `cycle_insights` |
| Telemetría | `user-events-schema.sql` | `user_events` |
| Notas / Health Twin | `notes-schema.sql` | `notes` |
| Compliance | `profiles-terms-consent.sql` | columnas de consentimiento en `profiles` |
| Storage | `SAVIA_STORAGE_food_photos.sql`, bucket `body-comps` en `SAVIA_BODY_COMPOSITIONS.sql` | buckets `food-photos`, `body-comps` |

**Nota:** el "motor de correlaciones n-of-1" descrito como ventaja competitiva central en el
BRD (sección 7) todavía no tiene una tabla o edge function dedicada visible en el repo — hoy
las relaciones se infieren dentro del prompt/lógica del coach (`ai-chat-stream`) y de
`generate-savia-pulse`, no como un motor separado y auditable.

### Cómo se relacionan los `.sql` entre sí

Es un modelo en estrella: casi todas las tablas cuelgan directo de `auth.users(id)` vía
`user_id` (o `patient_user_id`/`uploaded_by_user_id` en las B2B-ready), sin un esquema
normalizado central. Las excepciones con FK tabla-a-tabla son:

- `SAVIA_MEAL_PLANS.sql`: `meal_plans` → `plan_meals` → `plan_meal_items`; `plan_supplements`
  y `plan_rules` cuelgan también de `meal_plans`. El mismo archivo altera `meal_logs` (de
  `SAVIA_NUTRITION_SCHEMA.sql`) para agregarle `plan_id`/`plan_meal_id`, conectando el log
  manual/foto con el plan que el nutricionista subió.
- `SAVIA_WEARABLES.sql`: `wearable_sync_log` → `wearable_connections`.
- `coach-schema.sql`: `coach_messages` → `coach_threads`.
- `women-health-schema.sql`: `cycle_day_logs` y `hormonal_state_daily` → `cycle_logs`;
  `women_health_profile` además referencia `auth.users` dos veces (paciente y
  `clinician_user_id` opcional, mismo patrón B2B que `body_compositions`).
- `savia-pulse-migration-002-*` y `women-health-migration-001-*` son `ALTER TABLE` sobre
  schemas ya creados, no tablas nuevas — se ejecutan después del script base.

Fuera de esos casos, los dominios (nutrición, composición, entrenamiento, wearables, coach,
pulse, transformación, women's health) son independientes entre sí a nivel de FK — se
relacionan por `user_id` compartido y por convención de fecha/timestamp, no por join
declarado. Eso es justo el vacío que llenaría el futuro motor de correlaciones: hoy la
relación "sueño ↔ composición" no vive en el schema, se infiere en tiempo de consulta/prompt.

### Backend (edge functions, Deno) — `supabase/functions/`

| Función | Rol |
|---|---|
| `ai-chat-stream` | Coach conversacional principal. SSE streaming, tool-calling (log_meal, log_water, log_workout, get_balance…), ventana deslizante de historial (MAX_HISTORY=4). La función más grande y crítica. |
| `generate-savia-pulse` | Genera el insight hero "SAVIA Pulse" (8 categorías: recovery, nutrition, training_prep, post_workout, behavioral, body_comp, hormonal, transformation_arc). |
| `generate-transformation-chapter` | Narrativa de capítulo de transformación desde `source_type='inbody'`; reglas de estilo estrictas (sin markdown, sin listas, prosa humilde); fallback determinístico si Claude falla. |
| `parse-inbody-document` | Extrae métricas de composición corporal desde PDF/imagen InBody vía Claude Vision. |
| `analyze-food-image` | Estimación de macros desde foto de comida vía Claude Vision (costo por llamada, requiere JWT). |
| `search-food` | Proxy server-side a Open Food Facts (evita problema de CORS). |
| `track-event` | Ingesta de telemetría, lista blanca de eventos, inserta con service role. |

### Modelo de IA

- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) para coach, insights, visión (costo/latencia).
- **Claude Sonnet 4.6** reservado para tareas complejas.
- Guardrails del BRD: interpretación y seguimiento, no diagnóstico; profesional humano en el
  lazo para decisiones clínicas; nunca presentar correlación como causalidad.

### Stack e infraestructura

- **Frontend:** `onboarding.html`, vanilla JS, sin build, estado en localStorage.
- **Hosting:** Vercel (`usesavia.com`), estático (`vercel.json`: `buildCommand: null`,
  redirige `/` → `/onboarding.html`).
- **Backend:** Supabase (Postgres + Auth + Edge Functions + Storage).
- **Auth:** Supabase Auth — Google OAuth, email/password, WebAuthn/Face ID.
- **Wearables:** Strava (OAuth + sync); Apple HealthKit planeado.

## 3. Convenciones del proyecto

- **SQL como scripts, no migraciones.** No existe `supabase/migrations/` ni `config.toml`
  committeado. Cada `.sql` en la raíz se corre a mano en el SQL Editor de Supabase (el header
  de cada archivo trae el link directo al proyecto). Los scripts son **idempotentes**:
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de
  recrear. Sigue este patrón al agregar o modificar schema; los cambios incrementales van en
  un archivo `*-migration-NNN-<descripcion>.sql` nuevo (ver `savia-pulse-migration-002-*` y
  `women-health-migration-001-*` como ejemplo), no editando el schema original.
- **RLS siempre activo.** Toda tabla nueva con datos de usuario debe habilitar
  `ENABLE ROW LEVEL SECURITY` y policies explícitas por operación (SELECT/INSERT/UPDATE/DELETE),
  típicamente `auth.uid() = <owner_column>`. Ver `SAVIA_BODY_COMPOSITIONS.sql` como plantilla,
  incluyendo el patrón B2B (`patient_user_id` ≠ `uploaded_by_user_id`) para cuando un
  profesional sube datos por el paciente.
- **Storage buckets privados por defecto**, con policies basadas en
  `(storage.foldername(name))[1] = auth.uid()::text` y `file_size_limit`/`allowed_mime_types`
  explícitos.
- **Comentarios y nombres en español** en el SQL y docs de producto (dominio de negocio);
  identificadores de columnas/tablas en inglés snake_case.
- **Edge functions:** cada una vive en `supabase/functions/<nombre>/index.ts` y se
  espeja en un archivo de staging `supabase-edge-<nombre>.ts` en la raíz — si editas una,
  actualiza ambas copias o aclara cuál es la fuente de verdad antes de desplegar. Hay copias
  de staging sin función desplegada aún (`ai-daily-insight`, `parse-meal-plan`,
  `strava-oauth-callback`, `strava-sync-activities`) — legacy o pendientes, no asumir que
  están activas en producción.
- **No mezclar el track "aesthetic clinics"** con cambios de SAVIA Nutrición (MS002). Si un
  archivo o mockup parece pertenecer a ese track, confirmar antes de modificarlo.
- **README.md desactualizado:** describe un prototipo previo ("App de Péptidos"/`index.html`)
  que ya no existe. La entrada real de la app es `onboarding.html` (ver `vercel.json`). No
  confiar en el README para setup — usar `docs/CONTEXT.md` y este archivo.
- **Definition of Done** (de `docs/CONTEXT.md`): código con linting limpio, criterios de
  aceptación del ticket cumplidos, probado manualmente por el autor, PR revisado por el otro
  founder, merge a `develop`, ticket movido a QA/Done.

## 4. Flujo de trabajo por ticket

Aplica a todo ticket de Jira que se trabaje en este repo, de aquí en adelante:

1. **Antes de empezar:**
   - Crear una rama nueva desde `develop` con el nombre del ticket, ej.
     `MS002-7-logging-comida-ia`.
   - Mover el ticket a **"In Progress"** en Jira.
2. **Mientras se trabaja:**
   - Commits pequeños y frecuentes (no un commit gigante al final).
   - Cada mensaje de commit empieza con el código del ticket, ej.
     `MS002-7: ajusto validación de foto`.
3. **Al terminar:**
   - Push de la rama a GitHub.
   - Crear el Pull Request.
   - Actualizar el ticket en Jira a **"In Review"** (o el estado que corresponda) y agregar un
     comentario resumiendo qué se hizo.
4. **Si aparece algo fuera del ticket actual** (bug, deuda técnica, mejora): no mezclarlo con
   la rama/commit en curso. Avisar y crear un ticket nuevo en el backlog de Jira para eso.

Notas de ejecución:
- Ramas destructivas o push a `main`/`develop` directo, force-push, o cerrar/mergear PRs
  requieren confirmación explícita — este flujo cubre crear rama/PR/commits, no saltarse
  revisión.
- Si no se especifica el código de ticket al pedir una tarea, preguntar antes de crear rama o
  commitear, no inventar un código.
