// =========================================================
// SAVIA Edge Function: parse-meal-plan
// Recibe foto o PDF del plan nutricional y devuelve estructura completa:
// - Header (nutricionista, paciente, frase)
// - Targets de macros del plan
// - Comidas con items + opciones intercambiables + alternativas
// - Suplementos
// - Reglas / observaciones
//
// DEPLOY:
//   mkdir -p supabase/functions/parse-meal-plan
//   cp supabase-edge-parse-meal-plan.ts supabase/functions/parse-meal-plan/index.ts
//   supabase functions deploy parse-meal-plan
//
// (Usa el mismo ANTHROPIC_API_KEY ya seteado para las otras Edge Functions)
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

const PROMPT = `Sos un nutricionista deportivo experto en parsear planes nutricionales de Centroamérica.

Analizá el documento (PDF o foto del plan) y extraé TODA su información en JSON estricto siguiendo este shape:

{
  "title": string | null,                       // título derivado, ej: "Plan Recomposición 2495 kcal"
  "nutritionist": {
    "name": string | null,                      // ej: "Dra. Sofía López"
    "contact": string | null,                   // teléfono ej: "+506 6403-6566"
    "handle": string | null                     // user social ej: "Dra.SofiaLopez"
  },
  "patient_name": string | null,                // si aparece, ej: "Victor Lacayo"
  "motivational_quote": string | null,          // si hay frase al pie, sin las comillas
  "targets": {
    "kcal": number | null,                      // total del plan
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null,
    "water_ml": number | null,                  // si dice 3-4L, devolvé el promedio en ml (3500)
    "protein_per_kg": number | null             // si dice "2.4g/kg"
  },
  "meals": [
    {
      "slot": "desayuno" | "merienda" | "pre_entreno" | "almuerzo" | "snack_pm" | "cena" | "post_entreno" | "snack_am" | "otro",
      "custom_label": string | null,            // override si el plan usa nombre distinto, ej: "Pre entreno rápido"
      "scheduled_time_label": string | null,    // raw del plan, ej: "9:00", "3:30-4 PM"
      "scheduled_time_24h": string | null,      // normalizado a HH:MM (24h), ej: "09:00", "15:30"
      "alternative_group": string | null,       // si esta comida es alternativa de otra, ID compartido (ej "pre_entreno_alt")
      "alternative_label": string | null,       // 'A', 'B', etc. para mostrar como tabs
      "items": [
        {
          "name": string,                       // ej: "Huevos enteros", "Pechuga de pollo desmenuzada"
          "quantity_text": string,              // raw del plan: "4", "250g", "180g", "Libre"
          "quantity_g": number | null,          // gramos parseados (null si "libre" / "al gusto")
          "unit_count": number | null,          // para unidades discretas: 4 huevos = 4, 2 rebanadas = 2
          "selection_group": "protein" | "carb" | "fruit" | "fat" | "vegetable" | "beverage" | "dairy" | "free",
          "is_required": boolean,               // true = el ítem es obligatorio; false = es una opción dentro del selection_group
          "is_free_quantity": boolean,          // true si dice "libre" / "al gusto"
          "kcal_est": number,                   // estimación de kcal (entero)
          "protein_g_est": number,              // gramos de proteína estimados
          "carbs_g_est": number,
          "fat_g_est": number
        }
      ]
    }
  ],
  "supplements": [
    {
      "name": string,                           // ej: "Creatina", "Magnesio", "Omega 3", "L-Arginina", "Picolinato de cromo"
      "dose": string | null,                    // ej: "5g diarios", "1 scoop", "2 cápsulas"
      "timing": string | null                   // ej: "Antes de dormir", "Pre entreno", "Con desayuno o cena", "Diario"
    }
  ],
  "rules": [
    {
      "rule_type": "general" | "conditional" | "hydration" | "supplement",
      "rule_text": string                       // texto crudo de la observación
    }
  ]
}

REGLAS DE PARSEO CRÍTICAS:

1. OPCIONES INTERCAMBIABLES dentro de una comida (separadas por "O", "ó", "/", o lista de alternativas):
   - "4 huevos enteros O 250g claras de huevo" → 2 items distintos en el MISMO selection_group "protein", AMBOS con is_required: false.
   - "180g pollo, atún, carne de res, corvina, tilapia" → 5 items en selection_group "protein", todos is_required: false.
   - "1 banano O mandarina O fruta de preferencia" → 3 items en selection_group "fruit", is_required: false.
   - Si el plan dice "300g papa Ó 200g camote Ó 180g arroz" → 3 items en selection_group "carb", is_required: false.

2. ITEMS FIJOS (sin alternativas) → is_required: true, selection_group según el tipo.

3. CANTIDADES "LIBRES" / "AL GUSTO":
   - quantity_g: null, is_free_quantity: true.
   - Para café negro, canela, vegetales libres, agua: kcal/macros ≈ 0.

4. COMIDAS ALTERNATIVAS (mutuamente excluyentes entre sí):
   - "Pre entreno" (comida completa) y "Pre entreno rápido" (batido + banano) son 2 entradas separadas en meals[].
   - Ambas comparten alternative_group: "pre_entreno_alt".
   - alternative_label: "A" para la primera, "B" para la segunda.
   - Si NO hay alternativas, alternative_group y alternative_label son null.

5. NORMALIZACIÓN DE HORARIOS:
   - "9:00" → "09:00"
   - "3:30-4 PM" → "15:30" (usá el inicio del rango)
   - "7:30 PM" → "19:30"

6. ESTIMACIÓN DE MACROS:
   - Para cada item, estima kcal y macros con tu mejor conocimiento.
   - Para items con quantity_g, basate en esa cantidad.
   - Para "4 huevos" usa ~70 kcal/huevo, ~6g proteína, ~5g grasa.
   - Para items "libre" (café, canela, vegetales), macros = 0 o cercano a 0.
   - VALIDACIÓN: la suma de items requeridos + 1 item promedio de cada grupo opcional debe aproximarse al total declarado en targets. Si difieren >20%, ajustá hacia arriba/abajo.

7. SUPLEMENTOS:
   - Solo los que aparecen explícitos en una sección de "suplementos" / "observaciones" / "indicaciones".
   - NO confundir con ingredientes de comidas (la proteína en polvo del pre-entreno rápido es ALIMENTO, no suplemento).

8. REGLAS:
   - Cada observación numerada o bullet va como una rule.
   - rule_type: "hydration" si menciona litros de agua; "supplement" si menciona dosis de un suplemento; "conditional" si tiene un IF (ej "si peso baja..."); "general" en cualquier otro caso.

9. SI EL DOCUMENTO NO ES UN PLAN NUTRICIONAL: devolvé exactamente {"error":"not_a_meal_plan"}.

10. SI NO PODÉS LEER NADA: devolvé exactamente {"error":"unreadable"}.

SALIDA: SOLO el JSON, sin texto antes ni después.`;

interface ParseInput {
  file?: string;     // base64
  mime?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_misconfigured" }, 500);

  let body: ParseInput;
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
  if (file.length > 12_000_000) {
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
        max_tokens: 8192,
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
      console.error("JSON parse failed:", jsonText.slice(0, 500));
      return json({ error: "parse_failed", raw: jsonText.slice(0, 500) }, 502);
    }

    if (parsed.error) {
      return json({ error: parsed.error }, 422);
    }

    // Normalización defensiva
    const num = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    const intOr = (v: any, fallback = 0): number => {
      const n = num(v);
      return n != null ? Math.round(n) : fallback;
    };

    const clean = {
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 200) : null,
      nutritionist: {
        name: parsed.nutritionist?.name || null,
        contact: parsed.nutritionist?.contact || null,
        handle: parsed.nutritionist?.handle || null,
      },
      patient_name: parsed.patient_name || null,
      motivational_quote: parsed.motivational_quote || null,
      targets: {
        kcal: intOr(parsed.targets?.kcal, 0) || null,
        protein_g: num(parsed.targets?.protein_g),
        carbs_g: num(parsed.targets?.carbs_g),
        fat_g: num(parsed.targets?.fat_g),
        water_ml: intOr(parsed.targets?.water_ml, 0) || null,
        protein_per_kg: num(parsed.targets?.protein_per_kg),
      },
      meals: Array.isArray(parsed.meals)
        ? parsed.meals.map((m: any, idx: number) => ({
            slot: typeof m.slot === "string" ? m.slot.toLowerCase() : "otro",
            custom_label: m.custom_label || null,
            scheduled_time_label: m.scheduled_time_label || null,
            scheduled_time_24h: m.scheduled_time_24h || null,
            alternative_group: m.alternative_group || null,
            alternative_label: m.alternative_label || null,
            display_order: idx,
            items: Array.isArray(m.items)
              ? m.items.map((it: any, jdx: number) => ({
                  name: String(it.name || "").slice(0, 200),
                  quantity_text: it.quantity_text || null,
                  quantity_g: num(it.quantity_g),
                  unit_count: num(it.unit_count),
                  selection_group: typeof it.selection_group === "string" ? it.selection_group.toLowerCase() : "free",
                  is_required: it.is_required !== false,
                  is_free_quantity: it.is_free_quantity === true,
                  kcal_est: intOr(it.kcal_est, 0),
                  protein_g_est: num(it.protein_g_est) || 0,
                  carbs_g_est: num(it.carbs_g_est) || 0,
                  fat_g_est: num(it.fat_g_est) || 0,
                  display_order: jdx,
                }))
              : [],
          }))
        : [],
      supplements: Array.isArray(parsed.supplements)
        ? parsed.supplements.map((s: any, idx: number) => ({
            name: String(s.name || "").slice(0, 100),
            dose: s.dose || null,
            timing: s.timing || null,
            display_order: idx,
          })).filter((s: any) => s.name)
        : [],
      rules: Array.isArray(parsed.rules)
        ? parsed.rules.map((r: any, idx: number) => ({
            rule_type: ["general", "conditional", "hydration", "supplement"].includes(r.rule_type) ? r.rule_type : "general",
            rule_text: String(r.rule_text || "").slice(0, 1000),
            display_order: idx,
          })).filter((r: any) => r.rule_text)
        : [],
    };

    // Validación mínima: al menos targets.kcal o al menos 1 meal
    if (!clean.targets.kcal && clean.meals.length === 0) {
      return json({ error: "no_data_extracted", raw: clean }, 422);
    }

    // Calcular totales por meal (suma de items requeridos)
    clean.meals.forEach((meal: any) => {
      const totals = meal.items.reduce(
        (acc: any, item: any) => {
          // Para opciones, contamos solo el "promedio" — pero como MVP, sumamos requeridos + el primero opcional de cada grupo
          if (item.is_required) {
            acc.kcal += item.kcal_est;
            acc.protein_g += item.protein_g_est;
            acc.carbs_g += item.carbs_g_est;
            acc.fat_g += item.fat_g_est;
          }
          return acc;
        },
        { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );
      // Añadir el promedio de items opcionales por selection_group
      const optionalGroups: Record<string, any[]> = {};
      meal.items.filter((it: any) => !it.is_required).forEach((it: any) => {
        if (!optionalGroups[it.selection_group]) optionalGroups[it.selection_group] = [];
        optionalGroups[it.selection_group].push(it);
      });
      Object.values(optionalGroups).forEach((group: any[]) => {
        const avg = group.reduce(
          (acc: any, item: any) => ({
            kcal: acc.kcal + item.kcal_est,
            protein_g: acc.protein_g + item.protein_g_est,
            carbs_g: acc.carbs_g + item.carbs_g_est,
            fat_g: acc.fat_g + item.fat_g_est,
          }),
          { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
        );
        const n = group.length;
        totals.kcal += Math.round(avg.kcal / n);
        totals.protein_g += avg.protein_g / n;
        totals.carbs_g += avg.carbs_g / n;
        totals.fat_g += avg.fat_g / n;
      });
      meal.total_kcal_est = Math.round(totals.kcal);
      meal.total_protein_g_est = Math.round(totals.protein_g * 10) / 10;
      meal.total_carbs_g_est = Math.round(totals.carbs_g * 10) / 10;
      meal.total_fat_g_est = Math.round(totals.fat_g * 10) / 10;
    });

    return json(clean);
  } catch (e) {
    console.error("parse-meal-plan exception:", e);
    return json({ error: "exception", message: String(e) }, 500);
  }
});
