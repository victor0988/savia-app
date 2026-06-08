# SAVIA Pulse · Hero Insight Card

*Diseño de un nuevo pattern para reemplazar el actual "AI Insight del día"*

---

## Problema

El insight actual es un **párrafo estático** que aparece una vez y no se actualiza. No aprovecha las dimensiones que SAVIA captura (composición corporal, alimentación histórica vs día, entrenamiento, hormonas, en el futuro sueño), no invita a conversación, no se siente vivo. Es informativo, no transformador.

## Visión

El insight es la **pieza más diferenciadora** de SAVIA porque NADIE en wellness combina InBody + nutrición + entrenamiento + hormonas + adherencia + tendencias en UN solo observación accionable. Whoop te da recovery score, Oura te da readiness, Apple Health te da rings. SAVIA te da **interpretación cruzada con acción y conversación**.

## Concepto: SAVIA Pulse

Una **card hero** en Hoy que:

1. **Cambia 3-5 veces al día** según contexto (mañana = recovery, mediodía = nutrición acumulada, post-entreno = ventana, noche = cierre)
2. **Cruza ≥2 dimensiones** siempre (no es "comiste 1500 kcal" — es "tu HRV cayó 8% y coincide con 3 días de proteína baja")
3. **Tap → abre chat** con el insight como primer mensaje del coach + invitación a profundizar
4. **Categorizado por color** según dimensión dominante (recovery, nutrición, training, body, hormones, behavioral)
5. **Indicador de freshness** ("hace 2h") visible

---

## Estados / Variantes

| Categoría | Cuándo | Cruza | Color accent |
|---|---|---|---|
| **Recovery** | Mañana (5-10am) | HRV + sleep + workout previo | Soft cyan `#7DD3C0` |
| **Nutrition** | Mediodía / pre-comida (11am-3pm) | Acumulado del día + plan + frecuentes | Warm gold `#E9C77B` |
| **Training prep** | Pre-entreno (según training_time) | Recovery + nutrition + plan workout | Coral `#F4A89C` |
| **Post-workout** | 0-2h post workout | kcal_burned + ventana proteína + hidratación | Lime `#BEF264` |
| **Behavioral** | Cualquier momento (semanal) | Adherencia + tendencias + frecuentes | Sage `#9DC3A8` |
| **Body composition** | Días con InBody nuevo | Peso/masa magra/grasa + meta | Lavender `#C49FCF` |
| **Hormonal** (mujeres) | Solo si WH activado | Fase + energía + recovery + workout | Dusty rose `#E9A8B8` |

---

## Anatomía

```
┌────────────────────────────────────────────────┐
│  ● RECOVERY · hace 2h                          │  ← tag + freshness
│                                                  │
│  Tu HRV cayó 8% esta semana.                    │
│  Coincide con 3 días bajo target de proteína    │  ← headline (2-3 líneas máx)
│  — el cuerpo no recupera bien sin sustrato.     │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │  Hablar de esto con SAVIA  →             │  │  ← CTA chat
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### Detalle de componentes

- **Tag superior** (10px, letterspacing 1.5px, uppercase) — categoría + freshness ("hace 2h", "ahora", "ayer")
- **Dot del tag** — color de categoría con glow sutil
- **Headline** — Cormorant Garamond italic 16-18px, 2-3 líneas máximo, frase con dato + interpretación + acción implícita
- **CTA** — chip pill con flecha, fondo lime suave, indica que es interactivo
- **Toda la card es tappable** — no solo el CTA

---

## Comportamiento

### Al tap

1. Abre la pantalla `coach-chat`
2. El primer mensaje del coach es **el insight como mensaje conversacional**, no como card duplicada
3. Después del insight, el coach pregunta: "¿Querés profundizar en algo?" o invita: "Podemos repasar qué ajustar para que recuperes mejor."

### Actualización

- **Server-side**: Edge Function `generate-savia-pulse` corre cada N horas (cron) y guarda el insight en una tabla `savia_pulses`
- **Client-side**: al abrir Hoy, si el último pulse es >2h, refresca; sino muestra el cacheado
- **Animación**: cuando llega uno nuevo, fade-in + glow del dot 800ms

### Categorías son dinámicas

El generador (Edge Function con Claude Haiku) elige UNA categoría según:
- Hora del día
- Eventos recientes (workout en últimas 2h → post-workout)
- Phase del ciclo si aplica
- InBody nuevo en últimas 24h → body composition
- Si pasaron >3 días sin behavioral pattern → ese

---

## Tokens

| Token | Valor |
|---|---|
| **Padding interno** | 18px 20px 16px |
| **Border radius** | 18px |
| **Background base** | `rgba(255,255,255,0.04)` |
| **Border** | 1px `rgba(255,255,255,0.08)` + `border-left: 3px solid {category_color}` |
| **Tag font** | Inter 10px 700, letterspacing 1.5px |
| **Headline font** | Cormorant Garamond italic 17px, line-height 1.45 |
| **CTA font** | Inter 13px 600 |
| **Margin top** | 14px (después del Balance Energético) |

---

## Justificación de innovación

**Lo que NADIE tiene:**

| Producto | Tienen | NO tienen |
|---|---|---|
| Whoop | Recovery score numérico | Conexión con nutrición/comidas/plan |
| Oura | Readiness, sleep stages | Datos de comidas, plan nutricional |
| Apple Health | Rings, métricas crudas | Interpretación cross-dimensional |
| Flo / Clue | Tracking ciclo | Conexión con entrenamiento/nutrición |
| Cronometer / MyFitnessPal | Macros del día | Recovery, hormonas, tendencias |
| Levels (CGM) | Glucosa | Plan nutricional + workout + ciclo |

**SAVIA Pulse cruza las 6+ dimensiones que estos productos están aislados de uno y otro.** Esa es la unfair advantage del Health Twin que ya construimos.

---

## Roadmap de implementación

| Sprint | Qué |
|---|---|
| **Pulse 1** | Schema `savia_pulses` + Edge Function generador (Claude Haiku con todo el HT + behavioral + today context) + UI card en Hoy reemplazando el viejo `#hoy-ai-card` |
| **Pulse 2** | Tap → abrir chat con el insight como primer mensaje del coach. Animación de fresh. Persistencia (historial de pulses en Profile) |
| **Pulse 3** | Personalización del usuario: pin/dismiss insights. "Más como este" / "Menos como este" para entrenar al modelo de qué prioriza |
| **Pulse 4 (futuro)** | Push notification cuando aparece un insight crítico ("HRV cayó 15% — abrí SAVIA") |

---

## Preguntas abiertas

1. **Frecuencia ideal**: ¿4 al día (cada 6h) o lazy on-app-open (si pasaron >2h)? Lazy es más barato pero menos "vivo".
2. **Notificaciones**: ¿push cuando hay insight nuevo de alta importancia? Riesgo de fatigue.
3. **History**: ¿el usuario puede ver insights pasados en una vista "Pulse Journal"?
4. **Voz**: ¿el usuario puede pedir un insight on-demand ("dame un insight ahora")?

Estas son decisiones para después del MVP. Para Pulse 1 mi recomendación: lazy generation + sin push + sin history visible.
