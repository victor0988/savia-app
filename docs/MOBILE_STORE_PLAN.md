# MOBILE_STORE_PLAN.md — SAVIA Nutrición a App Store + Google Play

**Microsolución:** MS002 · **Epic Jira:** MS002-14 (Mobile & Store Readiness)
**Enfoque:** reutilizar el esqueleto web actual (SPA `onboarding.html` + Supabase) envuelto con **Capacitor**, reforzado con capacidades nativas. Migración progresiva a módulos/native después. Decisión técnica final con Fede.

> **Diferido:** suscripciones in-app (IAP/billing) — el modelo de cobro se define más adelante. Este runbook no lo incluye.

---

## Fase 0 — Decisiones previas

- **Entidad de la cuenta de developer:** a nombre de **Victor** o de **Guendy Salazar** (tiene formación en ingeniería), o una **empresa CR**. Definir antes de abrir cuentas (afecta impuestos/banco y quién firma las apps).
- **Capacitor vs rebuild RN:** se adopta Capacitor como puente (reúsa el SPA). Confirmar con Fede; el playbook del equipo asume RN/EAS, acá no aplica EAS.
- **CI/CD mobile:** Fastlane + GitHub Actions, o Codemagic / Ionic Appflow (Capacitor **no** usa EAS).

---

## Fase 1 — Cuentas de developer (MS002-21)

- **Apple Developer Program:** ~$99/año. Requiere Apple ID + (si es empresa) número DUNS. Da acceso a App Store Connect.
- **Google Play Developer:** ~$25 pago único. Da acceso a Google Play Console.
- Habilitar 2FA en ambas; guardar credenciales en el gestor del equipo.

---

## Fase 2 — Setup Capacitor (MS002-15)

1. En el repo `savia-app`, inicializar Capacitor sobre el SPA (la web actual = el `webDir`).
2. Generar plataformas: `ios` y `android`.
3. Configurar **bundle IDs** (ej. `com.savia.nutricion`), nombre de app, versión.
4. **Ícono y splash** (assets desde el logo SAVIA).
5. Verificar que corre en simulador y en dispositivo físico; generar **build firmado** para ambas plataformas.

> Resultado: la web actual funcionando como app nativa instalable, base para sumar capacidades.

---

## Fase 3 — Capacidades nativas (una por historia)

| Capacidad | Jira | Plugin / API | Nota |
|---|---|---|---|
| Cámara nativa | MS002-16 | Capacitor Camera | comida / InBody / progreso; permisos con fallback |
| Datos de salud | MS002-17 | HealthKit (iOS) / Health Connect (Android) | alimenta el módulo `wearables`; consentimiento + disclosures |
| Push | MS002-18 | Capacitor Push / FCM + APNs | nudges del coach, no genéricos |
| Deep links + offline + biometría | MS002-19 | App URLs / Network / Biometric Auth | offline en captura; Face ID / huella |
| Borrado de cuenta + privacidad | MS002-20 | flujo propio + formularios store | requisito Apple 5.1.1; App Privacy / Data Safety |

---

## Fase 4 — Compliance de review (MS002-20, MS002-21)

Lo que típicamente hace que rechacen o aprueben:
- **No ser "solo un wrapper"** (Apple 4.2): el valor nativo (cámara, salud, push, biometría) es lo que lo salva.
- **Borrado de cuenta in-app** (Apple 5.1.1(v)): obligatorio.
- **Etiquetas de privacidad veraces:** App Privacy (iOS) y Data Safety (Android), con foco en datos de salud.
- **Permisos con propósito claro** (textos de uso de cámara/salud/notificaciones).
- **Política de privacidad** enlazada (ya existe en la app).

---

## Fase 5 — Assets de store y publicación (MS002-21)

- Screenshots por tamaño de dispositivo, descripción, keywords, categoría (Salud y forma física).
- Completar fichas en **App Store Connect** y **Google Play Console**.
- Subir builds, completar review forms, enviar a revisión.
- Release (puede ser fase beta: TestFlight / Play Internal Testing primero).

---

## Orden sugerido de ejecución

1. Fase 0 (decisiones) → 2. Cuentas → 3. Shell Capacitor (MS002-15) → 4. Cámara + Salud + Push (MS002-16/17/18) → 5. Deep links/offline/biometría (MS002-19) → 6. Borrado de cuenta + privacidad (MS002-20) → 7. Assets + review + release (MS002-21).

> Beta interna (TestFlight / Play Internal) apenas el shell + cámara funcionen, para validar con María y Sofía López antes del release público.

---

*Tramo 3 en Jira MS002 (~37 pts estimados). IAP/suscripciones: diferido.*
