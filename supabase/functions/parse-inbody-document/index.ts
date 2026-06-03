// =========================================================
// SAVIA Edge Function: parse-inbody-document
// Recibe PDF o imagen de InBody y extrae métricas con Claude.
//
// DEPLOY:
//   mkdir -p supabase/functions/parse-inbody-document
//   cp supabase-edge-parse-inbody.ts supabase/functions/parse-inbody-document/index.ts
//   supabase functions deploy parse-inbody-document
//
// (Usa el mismo ANTHROPIC_API_KEY ya seteado para analyze-food-image)
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

const PROMPT = `Sos un experto en interpretar reportes de bioimpedancia (InBody 270, 570, 770, H20, dial).

Analizá este documento (PDF o foto del print) y extraé las métricas en JSON estricto:

{
  "weight_kg": número | null,
  "body_fat_pct": número | null,
  "muscle_mass_kg": número | null,           // SMM (Skeletal Muscle Mass)
  "lean_body_mass_kg": número | null,        // LBM o FFM (Fat Free Mass)
  "visceral_fat_level": entero | null,       // 1-30
  "bmr_kcal": entero | null,
  "total_body_water_kg": número | null,
  "raw_fields": { ... }                       // TODOS los demás campos visibles en el doc
}

REGLAS:
- Si un campo no es identificable, devolvé null para ese campo.
- raw_fields debe contener TODO lo demás (Body Fat Mass, Protein, Mineral, Cellular Water, Segmental Lean Analysis, ECW/TBW Ratio, InBody Score, etc.) — preservá nombres en el idioma original del reporte.
- Si el documento NO es un InBody (cualquier otro doc), devolvé {"error":"not_inbody"}.
- Si no podés leer nada, devolvé {"error":"unreadable"}.
- SOLO JSON. Sin texto antes ni después.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_misconfigured" }, 500);

  let body: { file?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const file = body.file;
  const mime = (body.mime || "image/jpeg").toLowerCase();
  if (!file || typeof file !== "string" || file.length < 100) {
    return json({ error: "file_required" }, 400);
  }
  if (file.length > 7_000_000) {
    return json({ error: "file_too_large" }, 413);
  }

  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");
  if (!isPdf && !isImage) {
    return json({ error: "unsupported_mime", mime }, 400);
  }

  try {
    const userContent: any[] = [];
    if (isPdf) {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file },
      });
    } else {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: mime, data: file },
      });
    }
    userContent.push({ type: "text", text: PROMPT });

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [
          { role: "user", content: userContent },
          { role: "assistant", content: "{" },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error:", resp.status, errText);
      return json({ error: "upstream_error", status: resp.status, detail: errText.slice(0, 500) }, 502);
    }

    const data = await resp.json();
    const raw = data?.content?.[0]?.text || "";
    const jsonText = "{" + raw;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse failed:", jsonText.slice(0, 200));
      return json({ error: "parse_failed", raw: jsonText.slice(0, 500) }, 502);
    }

    if (parsed.error) {
      return json({ error: parsed.error }, 422);
    }

    // Normalización + validación
    const num = (v: any) => {
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    const clean = {
      weight_kg: num(parsed.weight_kg),
      body_fat_pct: num(parsed.body_fat_pct),
      muscle_mass_kg: num(parsed.muscle_mass_kg),
      lean_body_mass_kg: num(parsed.lean_body_mass_kg),
      visceral_fat_level: parsed.visceral_fat_level != null ? Math.round(num(parsed.visceral_fat_level) || 0) : null,
      bmr_kcal: parsed.bmr_kcal != null ? Math.round(num(parsed.bmr_kcal) || 0) : null,
      total_body_water_kg: num(parsed.total_body_water_kg),
      raw_fields: parsed.raw_fields && typeof parsed.raw_fields === "object" ? parsed.raw_fields : {},
    };

    // Validación básica: al menos peso o body_fat debe estar presente
    if (clean.weight_kg == null && clean.body_fat_pct == null) {
      return json({ error: "no_metrics_extracted", raw: clean }, 422);
    }

    return json(clean);
  } catch (e) {
    console.error("parse-inbody-document exception:", e);
    return json({ error: "exception", message: String(e) }, 500);
  }
});
