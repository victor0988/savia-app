# CONTEXT.md — SAVIA Nutrición
> Paste this file at the start of every Claude session for this microsolution.
> Keep it updated. A stale CONTEXT.md is worse than no CONTEXT.md.

---

## Product Overview

**Microsolution ID:** MS002
**Name:** SAVIA Nutrición
**One-line description:** Capa de inteligencia personal que documenta, explica y optimiza la transformación corporal del usuario combinando nutrición, composición corporal, actividad, sueño y un coach de IA.
**Status:** QA/Beta (en producción con usuarios beta)
**Owner:** Victor (Product) · Fede (Tech)
**Jira project key:** MS002 (creado · fedegonzs.atlassian.net/browse/MS002)
**GitHub repo:** victor0988/savia-app
**Producción:** https://usesavia.com
**Target launch date:** Ya en beta live; GA por definir en Go/No-Go del equipo

> **Alcance:** SAVIA Nutrición = nutrición, composición corporal, salud metabólica, GLP-1 companion y Women's Health. El "OS para clínicas estéticas" (Aesthetic twin) es una microsolución **separada**, fuera del alcance de MS002. El repo `savia-app` hoy contiene artefactos de ambos; el track estético debe separarse a futuro.

---

## The Problem

Las personas en procesos de transformación corporal no logran entender por qué cambian (o por qué no), pierden motivación y abandonan. Los datos abundan (peso, sueño, pasos, calorías) pero no explican nada ni indican qué decidir. El nutricionista, además, no tiene continuidad ni evidencia entre citas. El problema no es la falta de datos: es la falta de explicación y de decisiones.

---

## The User

**Primary persona:** Persona en transformación corporal (recomposición, pérdida de grasa, GLP-1, longevidad) y la nutricionista clínica que la acompaña.
**What they're doing today (without us):** Apps de tracking de alta fricción (MyFitnessPal), señales aisladas (glucosa/recuperación) y seguimiento por WhatsApp/Excel del nutricionista.
**What we give them:** Una biografía continua de su cambio + un coach de IA que explica las relaciones entre hábitos y resultados y recomienda qué decidir.

**Usuarios beta actuales (preservar experiencia):**
- María — paciente nutricional con plan de Sofía López, primera usuaria real.
- Sofía López — nutricionista, partner clínico.

---

## What We're Building (MVP Scope)

Ya construido y funcionando en producción:
- Onboarding multi-paso (sexo, edad, objetivos, peso, body fat, método) + cálculo de targets (Mifflin-St Jeor ajustado por objetivo).
- Log de comidas: manual / foto con IA (Claude Vision) / barcode / búsqueda OpenFoodFacts; log de agua y de workouts (manual + sync Strava).
- InBody: subir PDF/foto → Claude Vision → guardar composición corporal.
- Plan nutricional: subir PDF → parseo a estructura por días/comidas.
- Coach SAVIA conversacional (Claude Haiku) con tool calling (log_meal, log_water, log_workout, get_balance…).
- Savia Pulse: insights de IA en 8 categorías (recovery, nutrition, training_prep, post_workout, behavioral, body_comp, hormonal, transformation_arc).
- Capítulos de transformación autogenerados + "Tu Evolución" (before/after + delta InBody).
- Women's Health (ciclo + fases + log diario).
- Tema premium sage & cream; compliance baseline (privacy/terms/consent).

**Explicitly out of scope for MVP (SAVIA Nutrición):**
- OS para clínicas estéticas / módulos aesthetic (PRP, Sculptra, skincare, dashboard clínica) — microsolución separada.
- HIPAA (en roadmap, no actual); GDPR baseline sí.

---

## Tech Stack

- **Frontend:** SPA single-file `onboarding.html` (HTML/CSS/JS vanilla, sin build step).
- **Backend:** Supabase (Postgres + Edge Functions en Deno).
- **Auth:** Supabase Auth (Google OAuth + email/password).
- **AI:** Anthropic Claude — Haiku 4.5 (coach + insights), Sonnet 4.6 (tasks complejos).
- **Storage:** Supabase Storage (fotos InBody / paciente).
- **Hosting:** Vercel (usesavia.com).
- **Wearables:** Strava (OAuth + sync), Apple Health (HealthKit).
- **Error tracking / compliance:** GDPR baseline; HIPAA en roadmap; Sentry pendiente.

> Nota: el stack actual (SPA single-file + Supabase) difiere del stack estándar del equipo (monorepo React/RN/Node). Decisión a registrar: mantener el stack actual de SAVIA o migrar al estándar del equipo.

---

## Repo Structure

Repo plano (no monorepo). Artefactos clave de nutrición:
```
savia-app/
├── onboarding.html              # SPA principal (producción)
├── SAVIA_*_SCHEMA.sql / *.sql   # Esquemas Supabase (nutrition, body comp, daily logs, wearables, workouts…)
├── SAVIA_CURRENT_STATE_SNAPSHOT.md
├── SAVIA_ROADMAP.md
├── docs/
│   ├── CONTEXT.md   (este archivo)
│   ├── BRD.md
│   └── DECISIONS.md
└── (artefactos aesthetic — track separado, fuera de MS002)
```

---

## Current Sprint

**Sprint number:** — (MS002 aún no entra al ciclo de sprints del equipo; MS001 es el build activo)
**Sprint goal:** —
**Sprint dates:** —

**In Progress:** —
**Listo:** Jira MS002 creado (6 epics + 7 historias; tramo 1 estimado, 28 pts). PRD escrito (docs/PRD.md).
**To Do (al entrar al ciclo):**
- Sprint Planning: comprometer el tramo 1 (MS002-7, MS002-9, MS002-10).
- Tech Design (Fede), incl. decisión de stack (mantener SPA+Supabase vs migrar al estándar) y arquitectura de módulos reutilizables.

---

## Key Decisions Made

(Detalle en docs/DECISIONS.md)
1. SAVIA Nutrición y el OS estético se gestionan como microsoluciones **separadas**.
2. Backend Supabase + Claude (Haiku coach / Sonnet tasks); frontend SPA single-file.
3. Branch `backup-nutrition-mvp` preserva el estado nutrición pre-pivote (rollback rápido).

---

## Known Risks / Open Questions

- Stack no estándar (SPA single-file ~24k líneas) vs. el estándar del equipo: ¿mantener o migrar?
- Regla dura: MS002 no puede estar "In Dev" mientras MS001 lo esté; definir si/ cuándo SAVIA toma el slot activo.
- Repo mezcla nutrición + estético: cuándo y cómo separar el track aesthetic.
- HIPAA pendiente si se escala a clínicas/EEUU.

---

## Definition of Done (DoD)

A ticket is done when:
- [ ] Code is written and passes linting
- [ ] Acceptance criteria from the Jira ticket are met
- [ ] Manually tested by the author
- [ ] PR has a description and has been reviewed by the other founder
- [ ] Merged to `develop`
- [ ] Jira ticket moved to QA or Done

---

*Last updated: 2026-06-18 by Victor*
