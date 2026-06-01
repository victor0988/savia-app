# SAVIA — QA Checklist (pre-push)

**Propósito**: invocar antes de cada push para evitar regresiones repetidas. Se actualiza cada vez que descubrimos un nuevo bug recurrente.

---

## 0. Step Number Map (autoritativo)

| `data-step` | Pantalla | Lo que el user ve |
|---|---|---|
| `0` | Splash | Logo + "Comenzar" + "Ya tengo cuenta" |
| `auth` | Auth Selector | 3 botones: Apple (disabled), Google, Email |
| `otp-email` | OTP step 1 | Input de email + "Enviar código" |
| `otp-verify` | OTP step 2 | 6 cuadritos de código |
| `login` | Login legacy | Email + password |
| `signup` | Signup legacy | Email + password |
| `forgot` | Forgot password | Email |
| `change-password` | Reset password | Nueva contraseña |
| `1` | Sexo + Edad | Hombre/Mujer + fecha nacimiento |
| `2` | **Objetivos** | Pérdida grasa, sueño, libido, etc. (Q2) |
| `2.4` | Conflict Mantenimiento | Mantenimiento vs Cambio |
| `2.5` | Conflict Recomp | Recomp/Cut/Bulk path |
| `3` | Nivel | Principiante / Intermedio / Avanzado |
| `4` | **Wearables** | Whoop, Oura, Apple Watch, Garmin, Fitbit, Ninguno |
| `5` | Nombre + Foto | Tu nombre + foto opcional |
| `6` | Calibrating | Animation "Calibrando..." |
| `7` | Now Preview | Preview del Now Screen + 3 botones (check-in/explore) |
| `verify` | Email gate (legacy, en desuso) | "Confirma tu email" |
| `8` | Face ID activation | "Activar biometría" |
| `app` | Hoy (main app) | "Hola, [Nombre]" + WQ |
| `profile` | Perfil | Avatar + objetivos + info + wearables + cuenta |

**Regla**: si tocás code que referencia un step, **verificar contra esta tabla primero**.

---

## 1. Pre-Push Static Checks

### A. Step references
```bash
# Grep todas las menciones de goStep + querySelector data-step
grep -nE "goStep\([0-9'\"]+\)|data-step=\"[0-9]+\"" onboarding.html
```
Cada match debe corresponder a la tabla de arriba.

### B. Function references (HTML → JS)
```bash
# Todas las funciones llamadas desde onclick=
grep -oE "onclick=\"[a-zA-Z_]+" onboarding.html | sort -u
```
Cada una debe estar definida en `<script>` (grep `function NAME` o `NAME = `).

### C. ID references (JS → HTML)
```bash
# Todos los IDs que el JS usa
grep -oE "getElementById\('[^']+'\)" onboarding.html | sort -u
```
Cada uno debe existir en el HTML (grep `id="NAME"`).

### D. State references
```bash
# Todas las propiedades de state.X que se leen
grep -oE "state\.[a-zA-Z_]+" onboarding.html | sort -u
```
Cada una debe estar inicializada en `const state = {...}` o ser un campo conocido.

### E. Routing path SDK audit (CRÍTICO — Safari hang)
```bash
# Buscar await sb.from() / sb.functions.invoke() DENTRO de _doRouteAuthenticatedUser
awk '/async function _doRouteAuthenticatedUser/,/^}/' onboarding.html | grep -nE "await sb\.(from|functions)"
```
**Debe devolver 0 resultados**. Cualquier `await sb.from()` en el routing path se cuelga en Safari post-OAuth (bug conocido del SDK). Las escrituras DEBEN ser fire-and-forget vía `fetch()` manual al REST API (patrón en `loadCurrentProfile` y sync-name).

**Por qué**: Safari ITP bloquea el SDK después del OAuth callback. Cualquier `await sb.from()` cuelga indefinidamente, dejando al user en pantalla negra. Reads ya están convertidos a manual REST; writes en el routing path deben ser fire-and-forget (no bloquean routing).

---

## 2. User Journey Mental Trace

Para cualquier cambio que toca UX, escribir paso a paso lo que pasa:

**Ejemplo (editar objetivos desde profile)**:
1. User en pantalla `profile`
2. Tap "Editar" → `editGoalsFromProfile()` corre
3. Settea `state.editingFromProfile = 'goals'`
4. Llama `customizeGoalsScreenForEditing()` → cambia eyebrow, continueBtn, backBtn de step 2
5. Llama `applyStateToUI()` → marca los goals existentes como `.selected` en step 2
6. `goStep(2)` → muestra pantalla de objetivos
7. User cambia goals → toggleGoal() agrega/quita de state.goals
8. Tap "Guardar" → `saveGoalsAndReturnToProfile()` → upsert + `openProfile()`
9. Vuelve a profile con chips actualizados

**Si no podés trazar el camino claro y completo, hay bug latente**.

---

## 3. Race Condition Patterns

⚠️ **Patrones que suelen romper**:

1. **Async + DOM update + listener**: si una función async dispara un evento que tiene un listener registrado, el orden de ejecución puede ser impredecible. Usar guards o single source of truth.

2. **Múltiples llamadas a `routeAuthenticatedUser`**: init + listener pueden disparar al mismo tiempo. Usar `_routingInProgress` guard.

3. **CSS class removal antes de DOM update**: ej. `classList.remove('oauth-loading')` ANTES de `goStep()` deja una pantalla intermedia visible (splash flash).

4. **localStorage saves durante navigation**: `saveOnboardingState()` en steps de auth contamina el state restore. Usar `skipPersist` array.

---

## 4. Critical Flows (Regression Tests)

Estos flows NO pueden romperse. Después de cualquier cambio significativo, mentalmente verificar:

| Flow | Pasos clave | Resultado esperado |
|---|---|---|
| **Google signup (nuevo)** | Comenzar → Google → autorizar | Pulse loading → step 1 (sexo) |
| **Fresh Google re-signup (delete + signup)** | Borrar user en Supabase → Comenzar → Google → autorizar | Pulse loading → step 1. ⚠️ NO debe colgarse después de "profile loaded" — el profile fresh tiene name="" y eso disparaba sync-name SDK update que se cuelga en Safari. Si "Route decision" log NO aparece, hay regresión |
| **Google login (existing)** | Comenzar → Google → autorizar | Pulse loading → app directo |
| **Email OTP signup** | Comenzar → Email → tipear → recibir código → ingresar | Sesión activa → onboarding o app |
| **Logout desde profile** | Profile → Cerrar sesión | Pulse loading → splash (sin calibrando flash) |
| **Editar goals** | Profile → Editar objetivos → cambiar → Guardar | Vuelve a profile con cambios |
| **Editar wearables (agregar)** | Profile → + Wearable → tap nuevo → Guardar | Vuelve a profile con nuevo wearable |
| **Editar wearables (eliminar)** | Profile → + Wearable → swipe-left en conectado → Eliminar → Guardar | Vuelve a profile sin ese wearable |
| **Cambiar foto perfil** | Profile → tap avatar → elegir foto → cropper → Aplicar | Foto actualizada en profile + app |
| **Face ID activation** | Onboarding step 7 → "Solo explorar" → activar | Sale prompt iOS → entra al app |
| **Welcome email** | Completar onboarding | Email "[Nombre], gracias por unirte" llega a Gmail |

---

## 5. Architectural Invariants

Cosas que NUNCA deben cambiar sin razón explícita:

- **flowType: 'implicit'** en Supabase SDK config (no PKCE — Supabase Auth devuelve implicit)
- **detectSessionInUrl: true** en SDK config
- **Site URL en Supabase**: `https://usesavia.com` (apex)
- **Redirect URLs en Supabase**: incluyen apex Y www
- **DNS only (gris) en Cloudflare** para records de Resend
- **Confirm email = OFF** en Supabase Auth (porque usamos password + biometric como 2FA)
- **handle_new_user trigger** crea profile al hacer signup

---

## 6. Cuando dudás → spawn un Agent

Si el cambio toca >50 líneas o es arquitectural, **spawnear un agent independiente** para code review:

```
Agent(general-purpose) → "Review this diff for [feature]. Check: step numbers correct vs SAVIA_QA_CHECKLIST.md Section 0, race conditions per Section 3, doesn't break Critical Flows Section 4."
```

---

## Changelog del checklist

- v1 (2026-05-31): bugs recurrentes capturados — step number mismatches, race conditions auth+routing, splash flashes, localStorage state pollution.
