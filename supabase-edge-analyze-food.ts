// =========================================================
// SAVIA Edge Function: analyze-food-image
// Recibe una foto base64 y devuelve macros estimados por Claude Vision.
//
// DEPLOY:
//   1. supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...
//   2. mkdir -p supabase/functions/analyze-food-image
//   3. cp supabase-edge-analyze-food.ts supabase/functions/analyze-food-image/index.ts
//   4. supabase functions deploy analyze-food-image
//      (NOTA: SIN --no-verify-jwt — esta función cuesta dinero por call)
//
// TEST (necesita JWT del user):
//   curl -X POST 'https://vlzzgttjrpyywmahwooi.supabase.co/functions/v1/analyze-food-image' \
//     -H 'Authorization: Bearer <USER_JWT>' \
//     -H 'apikey: <ANON_KEY>' \
//     -H 'Content-Type: application/json' \
//     -d '{"image":"<base64 jpeg>"}'
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

const PROMPT = `Eres nutricionista deportivo experto.

Analiza la foto y devuelve un JSON con los alimentos identificables, gramos estimados, y macros.

REGLAS:
- Solo incluí ítems con confianza razonable. Si no identificás nada, devolvé items: [].
- Estima gramos por porción visible en el plato (no por 100g).
- macros son TOTALES para esos gramos, no por 100g.
- confidence: 0.0-1.0 (1.0 = totalmente seguro).
- Formato JSON estricto, sin texto adicional.

Devuelve EXACTAMENTE este shape:

{"items":[{"food":"pollo a la plancha","grams":150,"kcal":248,"protein_g":46,"carbs_g":0,"fat_g":5.4,"confidence":0.9}],"notes":"breve, en español, opcional"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_misconfigured" }, 500);

  let body: { image?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const image = body.image;
  const mime = body.mime || "image/jpeg";
  if (!image || typeof image !== "string" || image.length < 100) {
    return json({ error: "image_required" }, 400);
  }
  // Sanity check: limit a ~2MB base64 (≈1.5MB binary)
  if (image.length > 2_800_000) {
    return json({ error: "image_too_large" }, 413);
  }

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
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mime, data: image },
              },
              { type: "text", text: PROMPT },
            ],
          },
          // Prefill con `{` fuerza al modelo a continuar el JSON directamente
          { role: "assistant", content: "{" },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error:", resp.status, errText);
      return json({ error: "upstream_error", status: resp.status }, 502);
    }

    const data = await resp.json();
    const raw = data?.content?.[0]?.text || "";
    // Reconstruir JSON completo (el prefill `{` no viene en el output)
    const jsonText = "{" + raw;
    let parsed: { items?: unknown[]; notes?: string };
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse failed:", jsonText.slice(0, 200));
      return json({ error: "parse_failed", raw: jsonText.slice(0, 500) }, 502);
    }

    // Validación + normalización de items
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const cleanItems = items
      .filter((i: any) => i && typeof i.food === "string")
      .map((i: any) => ({
        food: String(i.food).slice(0, 100),
        grams: Math.max(0, Math.min(2000, Number(i.grams) || 0)),
        kcal: Math.max(0, Math.round(Number(i.kcal) || 0)),
        protein_g: Math.max(0, Number(i.protein_g) || 0),
        carbs_g: Math.max(0, Number(i.carbs_g) || 0),
        fat_g: Math.max(0, Number(i.fat_g) || 0),
        confidence: Math.max(0, Math.min(1, Number(i.confidence) || 0.5)),
      }))
      .slice(0, 10);

    return json({
      items: cleanItems,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 200) : null,
    });
  } catch (e) {
    console.error("analyze-food-image exception:", e);
    return json({ error: "exception", message: String(e) }, 500);
  }
});
