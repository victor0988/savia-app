# Business Requirements Document
**Microsolution:** SAVIA Nutrición — MS002
**Author:** Victor
**Date:** 2026-06-18
**Status:** Draft (resumen ejecutivo; versión extendida en `SAVIA_BRD_v2_Transformacion.docx`)

> Alcance: solo SAVIA Nutrición (nutrición, composición corporal, salud metabólica, GLP-1, Women's Health). El OS para clínicas estéticas es una microsolución separada.

---

## 1. Problem Statement

Las personas en procesos de transformación corporal no logran percibir por qué cambian (o por qué no), pierden motivación y abandonan en semanas. El progreso es lento y multifactorial; la báscula engaña (peso ≠ composición); nadie conecta nutrición, entrenamiento, sueño y resultados. Las herramientas actuales o son commodities de logging de alta fricción (MyFitnessPal) o señales aisladas (glucosa, recuperación) que no explican el conjunto. Los nutricionistas carecen de continuidad y datos entre citas.

---

## 2. Target User

**Primary persona:** Persona en transformación corporal (recomposición / pérdida de grasa / GLP-1 / longevidad) + la nutricionista clínica que la acompaña (B2B2C).
**Size of the problem:** Mercado en auge (GLP-1, longevidad, composición corporal) en habla hispana / LatAm.
**Current workaround:** Apps de tracking de alta fricción, señales aisladas, seguimiento por WhatsApp/Excel.
**Why our solution is better:** No muestra datos: explica relaciones y recomienda decisiones, con los resultados (composición/InBody/fotos) como fuente de verdad y un coach de IA con memoria.

---

## 3. Proposed Solution

SAVIA es la capa de inteligencia personal de la transformación: documenta el cambio, explica por qué ocurre (motor de correlaciones n-of-1) y recomienda qué decidir. Los resultados son la fuente de verdad; nutrición, sueño, pasos y entrenamiento son variables que los explican. (Visión completa y replanteamiento en `SAVIA_BRD_v2_Transformacion.docx`.)

---

## 4. Business Goals

| Goal | Metric | Target | Timeline |
|------|--------|--------|----------|
| Validar el loop entender→decidir | Decisiones asistidas accionadas / semana (North Star) | Definir baseline con beta | 60 días |
| Retención | Usuarios activos a 8 semanas | Definir | Continuo |
| Outcome real | Cambio mediano de composición a 12 sem (activos) | Definir | 12 sem |
| Canal profesional | Nutricionistas activos que traen pacientes | Primeros 3-5 | 90 días |

---

## 5. Success Criteria (Go/No-Go para GA)

- [ ] El loop entender→decidir muestra uso recurrente real en beta.
- [ ] Evidencia de outcome (composición) entre usuarios activos.
- [ ] Al menos una nutricionista usándolo con sus pacientes de forma sostenida.

---

## 6. Constraints

- **Time:** Ya en beta; GA por definir.
- **Team:** Victor (Product, ~12h/sem) · Fede (Tech, ~12h/sem).
- **Technical:** Stack actual SPA single-file + Supabase + Claude. Decisión pendiente: mantener o migrar al estándar del equipo.
- **Regla dura:** No puede estar "In Dev" del equipo mientras MS001 lo esté.

---

## 7. Out of Scope

- OS para clínicas estéticas / módulos aesthetic (microsolución separada).
- HIPAA (roadmap, no actual).

---

## 8. Open Questions

- [ ] ¿Mantener stack actual o migrar al estándar del equipo (monorepo React/RN/Node)?
- [ ] ¿Cuándo separar el track estético a su propio repo?
- [ ] ¿SAVIA toma el slot "In Dev" del equipo (pausando MS001) o sigue como beta de Victor?

---

## Go/No-Go Decision

| Criterion | Status |
|-----------|--------|
| Problem is real (evidencia / usuarios beta) | ☑ (beta live con María + Sofía López) |
| Podemos sostener el build con la capacidad del equipo | ☐ |
| Métrica de éxito clara | ☐ |
| Sin bloqueos legales/compliance | ☐ (GDPR baseline; HIPAA pendiente) |

**Decision:** Go ☐ | No-Go ☐
**Decided by:** Both founders
**Date:** [pendiente]
**Notes:** SAVIA ya está en producción; el Go/No-Go aquí es sobre adoptarla como microsolución formal del equipo y su prioridad vs. MS001.
