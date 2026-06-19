# Decision Log — SAVIA Nutrición (MS002)

Significant decisions made during the design and development of this product.

**Rule:** Log any significant decision within 48 hours of making it. "Significant" means: architecture choices, vendor selections, scope changes, pivots, or anything you debated for more than 30 minutes.

---

## Decision Template

```
## [DECISION TITLE]
**Date:** YYYY-MM-DD
**Decided by:** Fede / Victor / Both
**Status:** Active | Superseded by [link]

### Context
Why did this decision need to be made?

### Options considered
- Option A: pros / cons
- Option B: pros / cons

### Decision
What was decided and why.

### Consequences
What this means going forward.
```

---

## Decisions

## SAVIA Nutrición y el OS estético son microsoluciones separadas
**Date:** 2026-06-18
**Decided by:** Victor
**Status:** Active

### Context
El repo `savia-app` acumuló artefactos de dos productos: la plataforma de nutrición/transformación corporal y un "OS para clínicas estéticas" (Aesthetic twin).

### Decision
Se gestionan como microsoluciones separadas. MS002 = SAVIA Nutrición (nutrición, composición, metabólico, GLP-1, Women's Health). El track estético es una microsolución aparte, fuera del alcance de MS002.

### Consequences
Los docs de MS002 (CONTEXT/BRD/PRD) cubren solo nutrición. A futuro conviene separar el track estético a su propio repo para evitar mezcla.

---

## Stack actual: SPA single-file + Supabase + Claude
**Date:** 2026-06-16 (registrado 2026-06-18)
**Decided by:** Victor
**Status:** Active (a revisar con Fede)

### Context
SAVIA Nutrición fue construida y validada como SPA single-file (`onboarding.html`) sobre Supabase (Postgres + Edge Functions Deno) con Claude (Haiku coach / Sonnet tasks), desplegada en Vercel (usesavia.com).

### Decision
Mantener el stack actual mientras esté en beta. Difiere del estándar del equipo (monorepo React/RN/Node).

### Consequences
Pendiente decidir con Fede (Tech): mantener el stack actual o migrar al estándar del equipo antes de escalar. Registrar la decisión cuando se tome.

---

## Branch `backup-nutrition-mvp` como rollback del MVP de nutrición
**Date:** 2026-06-16 (registrado 2026-06-18)
**Decided by:** Victor
**Status:** Active

### Context
Antes de explorar el pivote estético se preservó el estado del MVP de nutrición.

### Decision
El branch `backup-nutrition-mvp` conserva el estado nutrición para reactivación o rollback rápido sin pérdida de producto.

### Consequences
Si el track estético se separa, este branch es la base limpia de SAVIA Nutrición.
