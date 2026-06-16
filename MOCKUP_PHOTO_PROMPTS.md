# Prompts para fotos AI del mockup

**18 prompts optimizados para Midjourney / DALL-E 3 / Sora**

Generá las fotos con estos prompts, renombrá los archivos según las claves indicadas, y pegalos en `mockup-assets/`. El mockup las usa automáticamente cuando lo servís con `python3 -m http.server 8080`.

---

## Estilo común a todos los prompts

Para mantener coherencia visual con el theme Sage & cream de SAVIA, agregá al final de cada prompt:

```
soft cream beige background, natural studio lighting, medical photography aesthetic, no logos, no text, sharp focus, professional clinical portrait style, realistic skin texture, hyper-realistic, shot on Hasselblad H6D, depth of field --ar 2:3 --style raw --v 6
```

Para Midjourney v6/v7. Si usás DALL-E 3 o Sora, remové los flags `--ar` y `--style` y agregá "shot in portrait orientation".

---

## MARÍA — Pérdida de grasa con GLP-1 (35 años, latina)

### `maria-portrait.jpg` · 300×300 · avatar
> Professional clinical portrait of a 35 year old Latin woman with shoulder length dark wavy hair, neutral expression looking slightly off camera, natural makeup, warm soft skin tone, wearing a cream colored knit sweater, cream beige background, natural studio lighting, medical photography aesthetic, hyper-realistic, shot on Hasselblad

### `maria-evo-before.jpg` · 400×600 · semana 0
> Full body professional clinical photo of a 35 year old Latin woman, slightly overweight body, neutral face expression, standing front view with arms relaxed at sides, wearing simple sports bra and bike shorts in neutral beige tone, plain cream beige background, soft natural studio lighting, medical photography aesthetic, hyper-realistic skin texture, portrait orientation

### `maria-evo-after.jpg` · 400×600 · semana 12
> Full body professional clinical photo of the same 35 year old Latin woman as before, now visibly slimmer with defined waist, neutral face expression, standing front view with arms relaxed at sides, wearing the same simple sports bra and bike shorts in neutral beige tone, plain cream beige background, soft natural studio lighting, medical photography aesthetic, hyper-realistic skin texture, portrait orientation

### `maria-chapter-12.jpg` · 400×300 · "Tu cintura encontró su ritmo"
> Lifestyle photo of a 35 year old Latin woman in athletic wear measuring her own waist with a soft measuring tape in front of a mirror, warm morning light, minimal interior, candid moment, cream and sage tones, photorealistic

### `maria-chapter-11.jpg` · 400×300 · "El plato empezó a comerte menos"
> Lifestyle photo of a 35 year old Latin woman from above hands holding a small plate with a balanced healthy meal of grilled salmon, roasted vegetables and quinoa, marble countertop, soft natural light, minimal kitchen background, photorealistic food photography

### `maria-chapter-10.jpg` · 400×300 · "Dormir mejor cambió todo"
> Cinematic side view of a 35 year old Latin woman peacefully sleeping in a cream colored bed with linen sheets, soft dawn light through a window, minimal bedroom, photorealistic, dreamy mood

---

## VALERIA — Armonización facial (40 años, latina)

### `valeria-portrait.jpg` · 300×300 · avatar
> Professional clinical portrait of a 40 year old Latin woman with shoulder length dark straight hair, elegant features, slight smile, natural makeup, warm light skin tone, wearing a cream silk blouse, cream beige background, natural studio lighting, medical photography aesthetic, hyper-realistic, shot on Hasselblad

### `valeria-evo-before.jpg` · 400×600 · semana 0
> Frontal portrait clinical photo of a 40 year old Latin woman, neutral face expression, slightly tired skin texture, fine lines around eyes and forehead, hair pulled back with a headband, no makeup, looking directly at camera, plain cream beige background, soft frontal studio lighting, medical photography aesthetic, hyper-realistic skin texture detail

### `valeria-evo-after.jpg` · 400×600 · semana 8
> Frontal portrait clinical photo of the same 40 year old Latin woman, neutral face expression, visibly firmer brighter glowing skin, smoother forehead and eye area, hair pulled back with the same headband, no makeup, looking directly at camera, plain cream beige background, soft frontal studio lighting, medical photography aesthetic, hyper-realistic skin texture detail

### `valeria-chapter-12.jpg` · 400×300 · "Tu piel encontró su luz"
> Close up cinematic photo of a 40 year old Latin woman applying a serum to her face in front of a vanity mirror, warm morning light, minimal bathroom interior, candid moment, cream and sage tones, photorealistic

### `valeria-chapter-11.jpg` · 400×300 · "Tres semanas que cambiaron tu rostro"
> Lifestyle photo of a 40 year old Latin woman with bright firm skin smiling subtly looking out a window, soft natural light from the side, cream and sage interior, candid moment, photorealistic

### `valeria-chapter-10.jpg` · 400×300 · "La constancia con el protector"
> Top down photo of a marble bathroom counter with skincare products arranged elegantly, a glass bottle of vitamin C serum, a tube of SPF 50, a small jade roller, soft natural light, minimal styling, photorealistic, editorial product photography

---

## CARLOS — Longevidad y composición (45 años, latino)

### `carlos-portrait.jpg` · 300×300 · avatar
> Professional clinical portrait of a 45 year old Latin man with short dark hair with slight gray at temples, defined jaw, neutral expression looking slightly off camera, clean shaven, wearing a cream colored linen shirt, cream beige background, natural studio lighting, medical photography aesthetic, hyper-realistic, shot on Hasselblad

### `carlos-evo-before.jpg` · 400×600 · semana 0
> Full body professional clinical photo of a 45 year old Latin man, average build with slight midsection softness, neutral face expression, standing front view with arms relaxed at sides, wearing simple gray fitted athletic shorts and no shirt, plain cream beige background, soft natural studio lighting, medical photography aesthetic, hyper-realistic skin texture

### `carlos-evo-after.jpg` · 400×600 · semana 6
> Full body professional clinical photo of the same 45 year old Latin man, now visibly more muscular with defined shoulders and reduced midsection, neutral face expression, standing front view with arms relaxed at sides, wearing the same gray fitted athletic shorts and no shirt, plain cream beige background, soft natural studio lighting, medical photography aesthetic, hyper-realistic skin texture

### `carlos-chapter-12.jpg` · 400×300 · "Tu masa magra empezó a hablar"
> Lifestyle photo of a 45 year old Latin man stretching after a workout in a minimal home gym, soft natural light through a window, cream and sage interior, candid moment, photorealistic

### `carlos-chapter-11.jpg` · 400×300 · "Energía estable, sueño claro"
> Cinematic side view of a 45 year old Latin man waking up calmly in a cream linen bed with morning light streaming in through wooden blinds, peaceful expression, photorealistic, editorial wellness photography

### `carlos-chapter-10.jpg` · 400×300 · "Tu protocolo empezó a expresarse"
> Top down photo of a wooden countertop with a glass of water with electrolytes, a small bowl of whole almonds, an InBody scan printout barely visible at the edge, soft morning light, minimal styling, cream and sage tones, photorealistic editorial product photography

---

## Tips para que las fotos no se vean genéricas

- **Consistencia del modelo:** en Midjourney usá `--cref [link de la imagen del portrait]` para que las fotos `evo-before` y `evo-after` mantengan la misma persona. Si no tenés v6+, generá 4 variaciones y elegí la más coherente.
- **Antes/después coherentes:** ambas fotos deben tener misma ropa, misma pose, mismo fondo. Solo cambia la composición corporal.
- **Latino feel sutil:** "Latin woman" / "Latin man" tiende a producir features estereotipadas. Si querés diversidad, usá "mestiza woman with Costa Rican features" o "hispanic professional in his mid 40s".
- **Edades reales:** Midjourney tiende a hacer modelos jóvenes. Insistí con "35 year old", "40 year old", "45 year old" — y agregá "realistic age appropriate features, mature skin, not airbrushed".
- **Iluminación cream:** "soft warm beige natural light" es la pista clave para que se vean parte del theme SAVIA.

## Después de generar

1. Guarda cada foto con el nombre exacto del slot (ej. `maria-evo-before.jpg`)
2. Pegá los 18 archivos en `mockup-assets/` (en el folder del proyecto)
3. En terminal: `cd "/Users/victor.lacayo/Documents/Claude/Projects/App de Peptidos"`
4. Servir local: `python3 -m http.server 8080`
5. Abrir: `http://localhost:8080/savia-transformation-mockup.html`
6. Las fotos se cargan automáticamente. Si una falla, cae a la URL de Unsplash y vos te enterás.

## Para la reunión con la doctora

Llevá el mockup en tu Mac corriendo con `python -m http.server 8080`. Si la doctora pregunta "¿esa es una paciente real?", la respuesta correcta es:
*"Es un demo con fotos generadas por IA — las pacientes reales tienen su propia biblioteca y sus protocolos prescritos por su clínica."*

Eso comunica:
- Es una demo, no una mentira
- Hay infraestructura real detrás
- La doctora puede prescribir y trackear pacientes reales en SAVIA
