# Product Requirements Document
**Microsolution:** SAVIA Nutrición — MS002
**Author:** Victor
**Date:** 2026-06-18
**Status:** Draft
**BRD reference:** docs/BRD.md (y `SAVIA_BRD_v2_Transformacion.docx`)

---

## 1. Overview

Esta fase no construye SAVIA desde cero: **pule y escala lo que ya está vivo** en producción (usesavia.com) y, sobre todo, **convierte cada feature en un módulo reutilizable** que otras apps de la compañía puedan consumir. SAVIA Nutrición es el primer "consumidor" de una librería de features compartidos; el trabajo se organiza **por feature, una rama por feature**, para poder migrar cada mejora a las demás apps que comparten ese feature (p. ej. Aesthetic twin ya usa InBody y antes/después).

> Principio rector de la compañía: **los features no son de una app, son activos reutilizables.** Cada feature se pule pensando en cómo lo van a consumir 2, 3 o N apps.

---

## 2. Principio de arquitectura: features como módulos reutilizables

**El problema a resolver primero.** Hoy SAVIA vive en un SPA single-file (`onboarding.html`, ~25k líneas, HTML/CSS/JS vanilla, sin build). Eso impide el reuso: no se puede "sacar" un feature de un archivo monolítico para llevarlo a otra app. La visión multi-app exige modularizar.

**La regla de esta fase:** todo feature que se pula se **extrae a un módulo con interfaz limpia** (lógica desacoplada de la UI específica de SAVIA), de modo que cualquier app pueda consumirlo. Cada feature define:
- **Contrato (interfaz):** qué entra y qué sale, sin asumir la UI de SAVIA.
- **Dependencias externas:** Supabase, Claude, APIs (OpenFoodFacts, Strava…), aisladas tras adaptadores.
- **Datos:** tablas/esquema propios del feature, portables.

**Dónde viven los módulos (decisión con Fede — Tech):** opciones a evaluar — (a) paquete(s) compartido(s) en un repo `company-shared` que cada app importa; (b) monorepo con `packages/` (estándar del equipo); (c) extracción gradual feature por feature. Recomendación: empezar por (c) extrayendo cada feature a un módulo bien delimitado mientras se decide (a)/(b). Ver Open Questions.

**Convención de ramas:** una rama por feature, `feature/MS002-NN-<feature>` (p. ej. `feature/MS002-12-meal-logging`). Cada PR de feature deja el módulo más portable que antes.

---

## 3. Catálogo de features y su reusabilidad

| Feature | Estado actual | Reúso en otras apps | Prioridad de pulido |
|--------|---------------|---------------------|---------------------|
| Captura de comida (foto IA, barcode, OpenFoodFacts, manual) | Funciona | Alto (cualquier app de nutrición/wellness) | ★★★ |
| InBody / composición corporal (parse Vision + body comp) | Funciona | Alto (Aesthetic twin, longevidad) | ★★★ |
| Wearables sync (Strava, Apple Health) | Funciona | Alto (todas las apps de salud) | ★★★ |
| Coach conversacional (Claude + tool calling) | Funciona | Alto (coach reutilizable con tools por dominio) | ★★ |
| Savia Pulse (insights, 8 categorías) | Funciona | Medio-alto (motor de insights por dominio) | ★★ |
| Capítulos de transformación / evolución (antes-ahora) | Funciona | Alto (Aesthetic twin lo usa) | ★★ |
| Onboarding + targets nutricionales (Mifflin-St Jeor) | Funciona | Medio (núcleo de nutrición) | ★ |
| Women's Health (ciclo + fases) | Funciona | Medio (apps de salud femenina) | ★ |

---

## 4. User Stories & Acceptance Criteria

### Epic 1: Captura de comida (módulo `food-logging`)
Rama: `feature/MS002-NN-meal-logging`

**MS002-N — Endurecer el logging por foto IA**
> Como usuario, quiero registrar una comida con una foto y que la estimación sea confiable y editable, para no perder tiempo ni desconfiar del dato.

Acceptance criteria:
- Dado que tomo una foto, cuando la IA estima, entonces muestra los ítems con nivel de confianza y permite editar/eliminar cada uno antes de guardar.
- Dado un fallo de la IA, cuando no puede estimar, entonces ofrece búsqueda manual (OpenFoodFacts) o barcode sin perder el flujo.
- El módulo expone una interfaz `estimarComidaDesdeImagen(img) → items[]` desacoplada de la UI de SAVIA.

**MS002-N — Empaquetar `food-logging` como módulo portable**
> Como compañía, quiero que el logging de comida sea consumible por otra app, para no reescribirlo.

Acceptance criteria:
- La lógica (estimación, parsers, fuentes de datos) queda separada de la UI específica de SAVIA.
- Las dependencias (Claude Vision, OpenFoodFacts, barcode) están detrás de adaptadores reemplazables.
- Documentado: contrato de entrada/salida + esquema de datos del feature.

---

### Epic 2: InBody / composición corporal (módulo `body-composition`)
Rama: `feature/MS002-NN-inbody`

**MS002-N — Robustecer el parseo de InBody**
> Como usuario, quiero subir el PDF/foto de mi InBody y que extraiga bien todos los campos, para tener mi composición sin digitar.

Acceptance criteria:
- Dado un InBody (PDF o foto), cuando se procesa, entonces extrae peso, grasa %, músculo, grasa visceral, agua y metabolismo basal con validación de rangos.
- Dado un campo dudoso, cuando la confianza es baja, entonces lo marca para revisión en vez de guardar un valor falso.
- Módulo `parseInBody(doc) → bodyComposition` reutilizable (Aesthetic twin lo consume).

---

### Epic 3: Wearables sync (módulo `wearables`)
Rama: `feature/MS002-NN-wearables`

**MS002-N — Estabilizar Strava + Apple Health**
> Como usuario, quiero que mi actividad y sueño se sincronicen solos, para que el coach use datos reales.

Acceptance criteria:
- Dado que conecto Strava/Apple Health, cuando hay nueva actividad/sueño, entonces se sincroniza sin intervención y sin duplicar.
- Conectores detrás de una interfaz común `WearableConnector` para sumar nuevos wearables (Oura, Whoop) sin tocar el resto.

---

### Epic 4: Coach conversacional (módulo `coach`)
Rama: `feature/MS002-NN-coach`

**MS002-N — Coach con tools por dominio**
> Como usuario, quiero pedirle al coach registrar comida/agua/workout en lenguaje natural y que entienda mi historia.

Acceptance criteria:
- El coach ejecuta tools (log_meal, log_water, log_workout, get_balance) de forma confiable.
- El set de tools es **inyectable**: otra app puede registrar sus propias tools de dominio sobre el mismo motor de coach.

---

### Epic 5: Insights / Savia Pulse (módulo `insights`)
Rama: `feature/MS002-NN-pulse`

**MS002-N — Motor de insights por dominio**
> Como usuario, quiero un insight diario que conecte mis señales, para saber qué hacer hoy.

Acceptance criteria:
- Genera un insight diario claro y accionable a partir de las señales del usuario.
- Las categorías/plantillas de insight son configurables por app (SAVIA usa las 8 actuales; otra app define las suyas).

---

### Epic 6: Capítulos / evolución de transformación (módulo `transformation`)
Rama: `feature/MS002-NN-transformation`

**MS002-N — Evolución y capítulos portables**
> Como usuario, quiero ver mi antes-ahora y mis capítulos, para sentir el progreso.

Acceptance criteria:
- Comparador antes/ahora + capítulos autogenerados a partir de eventos (foto, InBody, hito).
- Módulo reutilizable (Aesthetic twin ya lo usa con fotos faciales/corporales).

---

### Epic 7: Mobile & salida a stores (Capacitor → iOS + Android)
Rama: `feature/MS002-NN-mobile-shell` (+ una rama por capacidad nativa)

> Reutiliza el esqueleto web actual envuelto con Capacitor. Cada capacidad nativa es su propia historia. Los módulos de feature deben quedar consumibles desde **web y nativo**.

**MS002-N — Shell Capacitor iOS + Android**
> Como usuario, quiero SAVIA en mi teléfono desde la store, para usarla como app nativa.

Acceptance criteria:
- Proyectos iOS y Android generados con Capacitor sobre el SPA actual; corren en simulador y dispositivo.
- Ícono, splash, nombre y bundle IDs configurados.

**MS002-N — Cámara nativa (comida / InBody / progreso)**
Acceptance criteria:
- Captura con cámara nativa (Capacitor Camera) integrada a food-logging / InBody / progreso.
- Permisos manejados con fallback claro si se deniegan.

**MS002-N — Datos de salud nativos (HealthKit / Health Connect)**
Acceptance criteria:
- Lectura de actividad/sueño desde HealthKit (iOS) y Health Connect (Android), alimentando el módulo `wearables`.
- Consentimiento y disclosures de datos de salud.

**MS002-N — Push notifications**
Acceptance criteria:
- Push nativo para nudges del coach (percibido como del coach/doctor, no genérico).

**MS002-N — Deep links + offline + biometría**
Acceptance criteria:
- Deep links a pantallas; tolerancia offline en captura; login biométrico opcional.

**MS002-N — Borrado de cuenta in-app + privacidad**
Acceptance criteria:
- Flujo de borrado de cuenta dentro de la app (requisito Apple).
- Etiquetas App Privacy (iOS) y Data Safety (Android) completas y veraces.

**MS002-N — Assets de store + compliance de review**
Acceptance criteria:
- Screenshots, descripciones, política de privacidad enlazada.
- La app pasa review de Apple/Google (valor nativo real; no "solo un wrapper").

> **Diferido (no en esta fase):** suscripciones in-app (IAP/billing). El modelo de cobro se define más adelante.

---

## 5. MVP Scope Summary (esta fase)

| Epic / Feature | Incluido ahora | Nota |
|----------------|----------------|------|
| Captura de comida (`food-logging`) | ✓ | Mayor fricción → primero |
| InBody (`body-composition`) | ✓ | Reúso inmediato en Aesthetic twin |
| Wearables (`wearables`) | ✓ | Base de datos reales para el coach |
| Coach (`coach`) | ✓ (parcial) | Tools inyectables |
| Insights (`insights`) | ✗ (siguiente) | Tras estabilizar señales |
| Transformación (`transformation`) | ✗ (siguiente) | — |
| Mobile & stores (`mobile`) | ✗ (tramo 3) | Capacitor + capacidades nativas; IAP diferido |

> Regla: cada feature entra en su propia rama y PR; al cerrar, el módulo queda más portable. No se mezclan dos features en una rama.

---

## 6. UX Notes

- No romper la experiencia de los usuarios beta actuales (María, Sofía López). La versión nutrición sigue siendo la default.
- Mantener el tema premium sage & cream.
- Cada feature pulido debe reducir fricción, no agregarla.

---

## 7. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Portabilidad del feature | Lógica desacoplada de UI; dependencias tras adaptadores |
| Latencia (captura foto/insight) | Pocos segundos / al abrir |
| Precisión IA | Confianza explícita + edición; nunca guardar valor dudoso silencioso |
| Privacidad | Datos de salud; consentimiento; GDPR baseline (HIPAA en roadmap) |
| Compatibilidad | No romper beta users; default = nutrición |

---

## 8. Definition of Done

Una historia está done cuando:
- [ ] Cumple los acceptance criteria
- [ ] El feature quedó más modular/portable que antes (lógica separada de UI)
- [ ] Probado manualmente por el autor
- [ ] PR con descripción, revisado por el otro founder
- [ ] Mergeado a `develop`
- [ ] Ticket Jira en QA o Done

---

## 9. Open Questions

- [ ] **(Con Fede — Tech) Arquitectura de reuso:** ¿paquete compartido `company-shared`, monorepo con `packages/`, o extracción gradual? Define cómo las otras apps consumen los módulos.
- [ ] **(Con Fede) ¿Refactor del SPA single-file?** El monolito `onboarding.html` bloquea el reuso. ¿Se extraen features uno a uno o se planifica una migración mayor?
- [ ] ¿Qué app es el segundo consumidor objetivo de cada módulo (Aesthetic twin para InBody/transformation)? Sirve para validar el contrato.
- [ ] Orden fino de pulido dentro de los 4 features del MVP.
- [ ] **(Mobile — con Fede)** ¿Capacitor como puente y migración progresiva, o rebuild RN? CI/CD con Fastlane/Codemagic (Capacitor no usa EAS).
- [ ] **(Mobile)** Cuenta de developer: Victor / Guendy Salazar / empresa CR.

---

*Approved by: Victor (Product) · Fede (Tech) · Date: [pendiente]*
