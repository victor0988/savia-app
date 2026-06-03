// =========================================================
// SAVIA Edge Function: ai-daily-insight
// Recibe contexto del día del user y devuelve un insight personalizado
// con voz de coach, basado en su data real.
//
// DEPLOY:
//   1. (Si no está ya) supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   2. mkdir -p supabase/functions/ai-daily-insight
//   3. cp supabase-edge-ai-daily-insight.ts supabase/functions/ai-daily-insight/index.ts
//   4. supabase functions deploy ai-daily-insight
//
// TEST (necesita JWT del user):
//   curl -X POST 'https://vlzzgttjrpyywmahwooi.supabase.co/functions/v1/ai-daily-insight' \
//     -H 'Authorization: Bearer <USER_JWT>' \
//     -H 'apikey: <ANON_KEY>' \
//     -H 'Content-Type: application/json' \
//     -d '{"hour":9,"consumed":{"kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0},"targets":{"kcal":2400,"protein_g":180,"carbs_g":240,"fat_g":80,"water_ml":3000},"hydration_ml":0,"workouts_today":[],"sleep_last_night":{"hours":7.5,"rating":4},"steps_today":0,"goal":"recomposition","name":"Victor","streak_days":3}'
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL = "claude-haiku-4-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SYSTEM_PROMPT = `Sos un coach personal de salud y nutrición para SAVIA, una app premium de wellness en Costa Rica/Centroamérica.

Tu voz:
- Directa, motivacional, sin filler corporativo.
- Habla en español tico/centroamericano casual ("mae", "diay", "tuanis") cuando el contexto sea relajado, pero nunca exagerado.
- Nunca preachy. Nunca "amazing!!!". Nunca culpa.
- Siempre explicás POR QUÉ con un dato concreto del usuario.
- Corto y útil — máximo 2-3 frases.

Reglas de decisión basadas en data real:

SUEÑO (sleep_hours):
- <4h: NO workout. Solo caminata 10-15min + stretching. "Hoy tu cuerpo pide descanso, no entrenamiento."
- 4-5h: Solo recovery. Yoga/mobility 20-30min.
- 5-6h: Drop intensidad 40%. Nada pesado.
- 6-7h: Normal pero moderado. Si pasa 3+ días así, flag.
- 7+h: Full intensidad. Verde para empujar.

MOMENTO DEL DÍA (hour):
- 5-10am: Saludo + sugerencia de desayuno proteico (25% del target de proteína).
- 10-12: Snack si va suave; recordar agua.
- 12-15: Almuerzo con meta de proteína acumulada (~40% del target).
- 15-18: Tarde — foco en proteína pendiente + hidratación.
- 18-22: Cierre del día. Cena fuerte si falta proteína.
- 22+/<5: Hora de descanso. Apagar pantallas, dormir 7-8h.

RACHA (streak_days):
- 3+ días seguidos: Reconocelo brevemente. Sube la vara con confianza.
- 0-1 días: No menciones la racha. Foco en hoy.

OBJETIVO (goal):
- fat_loss/recomposition: Cuidar déficit (~300-500 kcal), proteína alta.
- muscle_gain: Surplus moderado (~200-500 kcal), no excederse.
- maintenance: Cerca de 0 balance, foco en consistencia.

OUTPUT: JSON estricto con esta forma exacta:
{"insight":"texto del insight (2-3 frases, máx 280 caracteres)","actions":[{"label":"+ Desayuno proteico","module":"nutrition"}],"tone":"encouraging"}

- actions: array de 0-2 botones de acción. Cada uno con label corto y module ("nutrition" | "workout" | "sleep" | "hydration").
- tone: "encouraging" | "neutral" | "warning" (warning si flagging algo serio como sueño insuficiente recurrente).
- SOLO el JSON. Sin texto antes ni después.`;

interface InsightInput {
  hour?: number;
  day_of_week?: string;
  consumed?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  targets?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number };
  hydration_ml?: number;
  workouts_today?: Array<{ type: string; duration_min: number; kcal_burned: number }>;
  sleep_last_night?: { hours: number; rating?: number };
  steps_today?: number;
  goal?: string;
  name?: string;
  streak_days?: number;
  yesterday_completion?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_misconfigured" }, 500);

  let input: InsightInput;
  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Construir contexto textual del usuario para el modelo
  const ctx: string[] = [];
  const name = input.name || "el usuario";
  const hour = typeof input.hour === "number" ? input.hour : new Date().getHours();
  ctx.push(`Hora actual: ${hour}:00 (${input.day_of_week || ""})`);
  ctx.push(`Nombre: ${name}`);
  if (input.goal) ctx.push(`Objetivo: ${input.goal}`);

  if (input.targets) {
    ctx.push(`Targets del día: ${input.targets.kcal} kcal, ${input.targets.protein_g}g proteína, ${input.targets.carbs_g}g carbs, ${input.targets.fat_g}g grasa, ${input.targets.water_ml}ml agua`);
  }
  if (input.consumed) {
    const c = input.consumed;
    const pctK = input.targets ? Math.round((c.kcal / input.targets.kcal) * 100) : 0;
    const pctP = input.targets ? Math.round((c.protein_g / input.targets.protein_g) * 100) : 0;
    ctx.push(`Consumido hoy: ${c.kcal} kcal (${pctK}%), ${c.protein_g}g proteína (${pctP}%), ${c.carbs_g}g carbs, ${c.fat_g}g grasa`);
  }
  if (typeof input.hydration_ml === "number" && input.targets) {
    const pctH = Math.round((input.hydration_ml / input.targets.water_ml) * 100);
    ctx.push(`Hidratación: ${input.hydration_ml}ml (${pctH}% del target)`);
  }
  if (input.workouts_today && input.workouts_today.length > 0) {
    const total = input.workouts_today.reduce((s, w) => s + (w.kcal_burned || 0), 0);
    ctx.push(`Workouts hoy: ${input.workouts_today.length} sesión(es), ${total} kcal quemadas`);
  } else {
    ctx.push(`Workouts hoy: ninguno`);
  }
  if (input.sleep_last_night) {
    const s = input.sleep_last_night;
    ctx.push(`Sueño anoche: ${s.hours}h${s.rating ? ` (calidad ${s.rating}/5)` : ""}`);
  } else {
    ctx.push(`Sueño: sin data`);
  }
  if (typeof input.steps_today === "number") {
    ctx.push(`Pasos hoy: ${input.steps_today.toLocaleString()}`);
  }
  if (typeof input.streak_days === "number" && input.streak_days > 0) {
    ctx.push(`Racha actual: ${input.streak_days} días cumpliendo`);
  }
  if (typeof input.yesterday_completion === "number") {
    ctx.push(`Cumplimiento ayer: ${Math.round(input.yesterday_completion * 100)}%`);
  }

  const userMessage = `Contexto del usuario AHORA:\n${ctx.join("\n")}\n\nGenerá el insight para este momento exacto.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: userMessage },
          { role: "assistant", content: "{" },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error:", resp.status, errText);
      return json({ error: "upstream_error", status: resp.status, detail: errText.slice(0, 300) }, 502);
    }

    const data = await resp.json();
    const raw = data?.content?.[0]?.text || "";
    const jsonText = "{" + raw;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse failed:", jsonText.slice(0, 200));
      return json({ error: "parse_failed", raw: jsonText.slice(0, 300) }, 502);
    }

    // Validación + normalización
    const clean = {
      insight: typeof parsed.insight === "string" ? parsed.insight.slice(0, 320) : "",
      actions: Array.isArray(parsed.actions)
        ? parsed.actions
            .slice(0, 2)
            .map((a: any) => ({
              label: typeof a.label === "string" ? a.label.slice(0, 40) : "",
              module: typeof a.module === "string" ? a.module : null,
            }))
            .filter((a: any) => a.label)
        : [],
      tone: ["encouraging", "neutral", "warning"].includes(parsed.tone) ? parsed.tone : "neutral",
      generated_at: new Date().toISOString(),
      model: MODEL,
    };

    if (!clean.insight) {
      return json({ error: "empty_insight", raw: parsed }, 502);
    }

    return json(clean);
  } catch (e) {
    console.error("ai-daily-insight exception:", e);
    return json({ error: "exception", message: String(e) }, 500);
  }
});
