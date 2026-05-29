# SAVIA — Wellness OS Prototype

App web premium para optimización integral de salud, péptidos y wellness. Prototipo navegable con autenticación, foto de perfil, chat IA Socratic, y todas las features discutidas.

## Quick start local

Abre `index.html` en cualquier navegador moderno. La app funciona 100% client-side, sin servidor. Datos persisten en `localStorage` del navegador.

## Deployment en Vercel — 3 opciones

### Opción 1 — Vercel CLI (más rápido, 60 segundos)

```bash
# 1. Instala Vercel CLI globalmente
npm install -g vercel

# 2. En la carpeta del proyecto
cd "App de Peptidos"

# 3. Deploy
vercel

# Te pedirá:
# - Login (link a email o GitHub)
# - Project name: savia-app
# - Directory: ./
# - Override settings? No

# 4. Listo. Te da una URL tipo: https://savia-app.vercel.app
```

Para producción (URL fija sin sufijo de preview):
```bash
vercel --prod
```

### Opción 2 — GitHub + Vercel dashboard

```bash
# 1. Crear repo en GitHub
git init
git add index.html vercel.json README.md
git commit -m "SAVIA wellness OS"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/savia-app.git
git push -u origin main

# 2. Ir a https://vercel.com/new
# 3. Importar el repo
# 4. Deploy (configuración por defecto funciona)
```

Vercel detecta automáticamente que es un proyecto estático y lo despliega.

### Opción 3 — Drag & drop directo

1. Ve a https://vercel.com/new
2. Selecciona "Other" → "Upload"
3. Arrastra la carpeta completa (`index.html` + `vercel.json`)
4. Deploy

## Estructura del proyecto

```
App de Peptidos/
├── index.html          # App completa (HTML + CSS + JS inline)
├── vercel.json         # Configuración Vercel (headers de seguridad)
├── README.md           # Este archivo
└── SAVIA_prototipo.html  # Versión anterior (puede borrarse)
```

## Funcionalidades incluidas

### Autenticación + perfil
- Welcome screen con onboarding visual
- Registro en 3 pasos: cuenta, perfil + foto, objetivos
- Login para usuarios existentes
- Foto de perfil con upload local (FileReader → base64)
- Persistencia en `localStorage`
- Cerrar sesión y eliminar datos

### App principal (5 tabs)
1. **Hoy** — Greeting adaptativo por hora, recovery + training rings, presupuesto calórico con 4 macros, próxima dosis, restaurantes sugeridos, streak, calibration score
2. **Stack** — Péptidos activos (CJC, BPC, NAD+), adherencia, ciclos, suplementos, insights cruzados
3. **Cuerpo** — Body silhouette SVG con heat map, body fat / lean mass tracking, check-in de síntomas (6 ejes)
4. **SAVIA** — Chat conversacional con Socratic AI: pregunta clarificadora primero, luego respuesta con tu contexto + literatura citada
5. **Yo** — Perfil editable con foto, calibration score, modelos activos, fuentes profesionales (nutricionista, MD, coach, lab, wearable), configuración

### Modales bottom-sheet
- Log de comida (foto, código de barras, manual)
- Log de entrenamiento (auto-sync Whoop)
- Log de dosis con confirmación
- Detalles de restaurantes con macros y reserva
- Detalles de péptidos con prescriptor y compliance
- Agendamiento con disponibilidad del Dr. Ramírez
- Editar perfil

### Chat AI funcional
Prueba estas frases:
- "¿Puedo entrenar fuerte hoy?"
- "¿Qué cenar?"
- "¿El ayuno intermitente me sirve?"
- "¿Subo mi dosis de CJC?"
- "¿Por qué baja mi HRV en luteal?"
- "Análisis de mi último lab"
- "Agenda una cita"

## Próximos pasos para producción real

Cuando quieras pasar de prototipo a producto real, considera:

1. **Auth real**: Reemplazar `localStorage` con [Supabase Auth](https://supabase.com/auth) o [Clerk](https://clerk.com) (ambos free tier generoso)
2. **Database**: Supabase Postgres para perfiles, dosis, comidas, biomarkers
3. **AI real**: Reemplazar respuestas scripted con API de Anthropic Claude (`@anthropic-ai/sdk`)
4. **Storage de fotos**: Supabase Storage o Cloudinary para fotos de perfil + progreso
5. **Wearables**: Apple HealthKit (iOS app wrap con Capacitor) o Garmin Connect API
6. **Mobile native**: Convertir a React Native + Expo cuando crezca el usage
7. **Pagos**: Stripe + MercadoPago para Centroamérica

## Notas técnicas

- **Sin dependencias externas** salvo Google Fonts (Inter)
- **Single file** — toda la app en `index.html`
- **Mobile-first** — frame fijo 420×900 en desktop, full screen en móvil
- **Dark mode only** (intencional, wellness aesthetic)
- **localStorage** para persistencia (perfil + sesión)
- **FileReader API** para foto de perfil (base64 inline)

## Soporte de navegadores

- Chrome, Safari, Firefox, Edge (últimas 2 versiones)
- iOS Safari 14+
- Android Chrome 90+

## Privacidad

Esta versión prototipo guarda todo en `localStorage` del navegador del usuario. **Nada se envía a ningún servidor.** Es perfecto para testing personal. Para uso real con múltiples usuarios necesitas backend (Supabase recomendado).
