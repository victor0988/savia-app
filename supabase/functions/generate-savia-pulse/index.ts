// SAVIA Pulse — Generator Edge Function
// Sprint Pulse 1.2: Selector de categoría personalizado por lifestyle + Claude Haiku.
//
// Deploy: supabase functions deploy generate-savia-pulse
//
// Body: {
//   today_start_iso?: string,   // medianoche local del cliente
//   tz_offset_min?: number,     // getTimezoneOffset() del cliente
//   force?: boolean             // si true, ignora pulse activo y regenera
// }
// Response: { pulse: SaviaPulseRow, generated: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;

// ─── Categorías + tiempo de expiración + prompt específico ───────────

const CATEGORY_CONFIG: Record<string, { expires_hours: number; prompt: string }> = {
  recovery: {
    expires_hours: 6,
    prompt:
      "Categoría: RECOVERY. Es mañana o post-noche. Analizá sueño + recovery + entrenamiento de ayer + nutrición de ayer. Conectá patrones: si durmió mal Y le toca pierna hoy, decilo. Si HRV baja coincide con proteína baja, decilo.",
  },
  nutrition: {
    expires_hours: 4,
    prompt:
      "Categoría: NUTRICIÓN. Es mediodía o tarde. Analizá balance kcal+macros vs target del día. Detectá gaps específicos (proteína corta, hidratación cero, exceso de carbs). Si hay frecuentes históricos relevantes, mencionalos. Sé puntual con la acción.",
  },
  training_prep: {
    expires_hours: 2,
    prompt:
      "Categoría: PRE-ENTRENO. El usuario va a entrenar en las próximas horas según su lifestyle. Analizá si está listo: recovery + nutrición acumulada + tipo de entreno del día. Si va corto en algo (carbs pre-entreno, hidratación), decilo.",
  },
  post_workout: {
    expires_hours: 3,
    prompt:
      "Categoría: POST-ENTRENO. El usuario entrenó hace menos de 2h. Foco en ventana proteica (30-90 min ideal), hidratación, y conexión con el objetivo del usuario.",
  },
  behavioral: {
    expires_hours: 8,
    prompt:
      "Categoría: PATRÓN. Identificá UNA racha, adherencia, o pattern significativo de la última semana o quincena. Sé específico con números (días seguidos, % adherencia, frecuencia de algo). Si es positivo, celebralo; si negativo, señalalo sin lecturar.",
  },
  body_comp: {
    expires_hours: 12,
    prompt:
      "Categoría: COMPOSICIÓN CORPORAL. Hay InBody nuevo en 24h o cambio notable. Conectá con el goal del usuario: si su meta es recomposition y bajó grasa sin perder masa magra, celebralo; si subió grasa, decilo con respeto.",
  },
  hormonal: {
    expires_hours: 8,
    prompt:
      "Categoría: HORMONAL (Women's Health). Conectá la fase actual del ciclo con energía, fuerza, antojos, nutrición. Específico a la fase: ovulatoria → pico de fuerza, lútea tardía → bajón energético, etc.",
  },
  // ─── Bug D fix: foco transformación/evolución (no observación diaria) ───
  // El insight más potente del producto. Activado en pulse_type='weekly' o cuando
  // el user tiene suficiente data (≥21 días). Dos sub-templates dentro del prompt:
  //   - IDENTITY: comparar quién era hace 60-90d vs ahora ("Hace 60 días...")
  //   - TRAJECTORY: proyectar a futuro usando regresión simple ("Si sostenés...")
  // La data de transformation_arc viene precalculada en buildPulseContext.
  transformation_arc: {
    expires_hours: 168, // 7 días — uno por semana
    prompt:
      "Categoría: TRANSFORMACIÓN. SAVIA vende cambio, evolución, no observación diaria. Tu insight debe contar QUÉ se transformó en este usuario y/o A DÓNDE va. Elegí UNO de los dos ángulos según los datos disponibles:\n\n" +
      "(A) IDENTITY — si hay ≥60 días de data: comparar la versión actual del usuario vs la versión de hace 60-90 días. Foco en cambio de identidad, no en métricas frías. Ejemplo: 'Hace 60 días entrenabas 2 veces por semana. Ahora llevás 5. Esa no es una racha — es una versión nueva tuya.' Usá data específica de transformation_arc (workouts_per_week_first vs workouts_per_week_recent, adherencia_first vs adherencia_recent).\n\n" +
      "(B) TRAJECTORY — si hay ≥21 días de body_metrics con tendencia clara: proyectar cuándo llega al objetivo según ritmo actual. Ejemplo: 'Si sostenés el ritmo de las últimas 3 semanas, llegás a tu peso objetivo el 27 de julio. Faltan 5.2 kg.' Sé honesto con la fecha (no la inventes — usá weight_slope_per_week que viene precalculado).\n\n" +
      "Tono: directo, sincero, premium. Cero halago vacío. Cero 'wellness influencer'. El usuario tiene que sentir que SAVIA lo VE evolucionando.",
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Missing Authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !supabaseAnon || !serviceKey || !anthropicKey) {
      return jsonError("Server misconfigured", 500);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) return jsonError("Unauthorized", 401);

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const todayStartISO: string | undefined = body.today_start_iso;
    const tzOffsetMin: number = typeof body.tz_offset_min === "number" ? body.tz_offset_min : 0;
    const force: boolean = !!body.force;
    // Sprint 2.A: pulse_type permite distinguir morning/evening/weekly del daily.
    // Default 'daily' = comportamiento legacy (mismo prompt + selector).
    const pulseType: string = ["daily", "morning", "evening", "weekly"].includes(body.pulse_type)
      ? body.pulse_type
      : "daily";

    // ─── Race guard: si hay un pulse activo no expirado del MISMO type, devolverlo ───
    // (a menos que force=true). Filtramos por pulse_type para que morning y evening
    // coexistan el mismo día sin que uno borre al otro.
    if (!force) {
      const { data: existing } = await supabaseAdmin
        .from("savia_pulses")
        .select("*")
        .eq("user_id", user.id)
        .eq("pulse_type", pulseType)
        .eq("dismissed", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return jsonResponse({ pulse: existing, generated: false });
      }
    }

    // ─── Build context ───
    const ctx = await buildPulseContext(supabaseAdmin, user.id, todayStartISO, tzOffsetMin);

    // ─── Recientes pulses (para no repetir categoría) ───
    const { data: recentPulses } = await supabaseAdmin
      .from("savia_pulses")
      .select("category, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    // ─── Selector personalizado por lifestyle ───
    const selected = selectCategory(ctx, recentPulses || [], pulseType);
    console.log(
      `[savia-pulse] user=${user.id} category=${selected.category} reason="${selected.reason}"`,
    );

    // ─── Build prompt + llamar Haiku ───
    const systemPrompt = buildPulsePrompt(selected.category, ctx, pulseType);

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        { role: "user", content: "Generá el insight ahora." },
      ],
    });

    // Parse JSON output: intenta fenced markdown primero, luego brace match.
    // Si falla, fallback amigable (mejor que 500 al usuario en una hero card).
    const rawText = message.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => (b as any).text || "")
      .join("");
    let parsed: { headline: string; context_for_chat: string } | null = null;
    try {
      // Intento 1: fenced ```json ... ```
      const fenced = rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (fenced) {
        parsed = JSON.parse(fenced[1]);
      } else {
        // Intento 2: primer objeto JSON balanceado (non-greedy hasta el primer cierre que cierra el contexto)
        const obj = rawText.match(/\{[\s\S]*?\}(?=\s*(?:$|[^,:\[\]\{]))/) ||
                    rawText.match(/\{[\s\S]*\}/);
        if (obj) parsed = JSON.parse(obj[0]);
      }
    } catch (e) {
      console.error("[savia-pulse] JSON parse error:", e, "raw:", rawText.slice(0, 300));
    }

    if (!parsed || !parsed.headline || typeof parsed.headline !== "string") {
      // Fallback amigable: usar primera parte del raw como headline si parece prosa
      console.warn("[savia-pulse] using fallback headline. raw:", rawText.slice(0, 200));
      const fallbackHeadline = rawText.slice(0, 240).replace(/^[\s"'`{}\[\]]+/, "").trim();
      parsed = {
        headline: fallbackHeadline.length > 30
          ? fallbackHeadline
          : "Tu día tiene data nueva. Abrí el chat para profundizar.",
        context_for_chat: `El modelo generó un insight de categoría ${selected.category} pero el JSON falló. Profundizá en el estado del usuario según sus datos actuales.`,
      };
    }

    // Strip cualquier asterisco o markdown que el modelo haya dejado
    const cleanHeadline = stripMarkdown(parsed.headline).slice(0, 280);
    const cleanContext = stripMarkdown(parsed.context_for_chat || "");

    // ─── Insert en savia_pulses ───
    // expires_hours vive en CATEGORY_CONFIG, no en el retorno de selectCategory.
    // Fallback 4h si la categoría no tiene config (no debería pasar por el CHECK del schema).
    let expiresHours = CATEGORY_CONFIG[selected.category]?.expires_hours ?? 4;
    // Sprint 2.A: cap por pulse_type para que morning/evening no se queden activos
    // fuera de su ventana natural. Morning expira a las ~6h (cubre 7-13h),
    // evening a las ~6h (cubre 20-02h). Weekly aguanta el fin de semana.
    if (pulseType === "morning") expiresHours = Math.min(expiresHours, 6);
    else if (pulseType === "evening") expiresHours = Math.min(expiresHours, 6);
    else if (pulseType === "weekly") expiresHours = Math.max(expiresHours, 48);
    const expiresAt = new Date(
      Date.now() + expiresHours * 3600 * 1000,
    ).toISOString();

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("savia_pulses")
      .insert({
        user_id: user.id,
        pulse_type: pulseType,
        category: selected.category,
        headline: cleanHeadline,
        context_for_chat: cleanContext,
        expires_at: expiresAt,
        triggering_data: {
          reason: selected.reason,
          pulse_type: pulseType,
          ht_completeness: ctx.healthTwin?.completeness_score ?? null,
          today_meals_count: ctx.todayMeals.length,
          today_workouts_count: ctx.todayWorkouts.length,
          hour_local: ctx.hourLocal,
        },
        model: MODEL,
        input_tokens: message.usage?.input_tokens || null,
        output_tokens: message.usage?.output_tokens || null,
      })
      .select("*")
      .single();

    if (insErr) {
      console.error("[savia-pulse] insert error:", insErr);
      return jsonError("Failed to save pulse: " + insErr.message, 500);
    }

    return jsonResponse({ pulse: inserted, generated: true });
  } catch (err) {
    console.error("[savia-pulse] fatal:", err);
    return jsonError(String((err as Error)?.message || err), 500);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function stripMarkdown(s: string): string {
  return String(s || "")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/_([^_\n]+?)_/g, "$1")
    .trim();
}

// ─── Context Builder específico para Pulse ───────────────────────────

interface PulseContext {
  hourLocal: number;
  dayOfWeek: number; // 0=domingo
  todayISO: string;
  todayStartISO: string;
  healthTwin: any;
  behavioralPatterns: any;
  todayMeals: any[];
  todayWorkouts: any[];
  todayHydrationMl: number;
  todayTargets: any;
  recentInBody: any;
  whProfile: any;
  whTodayLog: any;
  currentPhase: string | null;
  cycleDay: number | null;
  // Bug D fix: data histórica precalculada para insight de transformación
  transformationArc: {
    days_active: number;
    workouts_per_week_first: number | null;   // primeras 4 sem desde signup
    workouts_per_week_recent: number | null;  // últimas 4 sem
    kcal_avg_first: number | null;
    kcal_avg_recent: number | null;
    protein_avg_first: number | null;
    protein_avg_recent: number | null;
    weight_first: number | null;
    weight_recent: number | null;
    weight_slope_per_week: number | null;     // kg/semana (regresión lineal)
    body_fat_first: number | null;
    body_fat_recent: number | null;
    has_identity_data: boolean;               // ≥60 días para ángulo IDENTITY
    has_trajectory_data: boolean;             // ≥21 días + tendencia clara para TRAJECTORY
  };
}

async function buildPulseContext(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  clientTodayStartISO: string | undefined,
  tzOffsetMin: number,
): Promise<PulseContext> {
  // Hora local
  const now = new Date();
  const nowLocal = new Date(now.getTime() - tzOffsetMin * 60000);
  const hourLocal = nowLocal.getUTCHours();
  const dayOfWeek = nowLocal.getUTCDay();

  const todayStartISO = clientTodayStartISO ||
    new Date(now.toISOString().split("T")[0] + "T00:00:00.000Z").toISOString();
  const todayISO = new Date(new Date(todayStartISO).getTime() - tzOffsetMin * 60000)
    .toISOString()
    .split("T")[0];

  // Queries en paralelo
  const [htRes, todayMealsRes, todayWorkoutsRes, hydRes, dailyRes, inBodyRes, whRes, whLogRes] =
    await Promise.all([
      supabase.from("user_health_twin").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("meal_logs")
        .select("items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, meal_category, ts")
        .eq("user_id", userId)
        .gte("ts", todayStartISO)
        .order("ts", { ascending: true }),
      supabase
        .from("workout_logs")
        .select("type, duration_min, intensity, kcal_burned, source, ts")
        .eq("user_id", userId)
        .gte("ts", todayStartISO)
        .order("ts", { ascending: false }),
      supabase
        .from("hydration_logs")
        .select("ml")
        .eq("user_id", userId)
        .gte("ts", todayStartISO),
      supabase
        .from("daily_logs")
        .select("kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml")
        .eq("user_id", userId)
        .eq("log_date", todayISO)
        .maybeSingle(),
      supabase
        .from("inbody_records")
        .select("weight_kg, muscle_mass_kg, body_fat_pct, recorded_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("women_health_profile")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("cycle_day_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayISO)
        .maybeSingle(),
    ]);

  const healthTwin = htRes.data;
  const todayMeals = todayMealsRes.data || [];
  const todayWorkouts = todayWorkoutsRes.data || [];
  const todayHydrationMl = (hydRes.data || []).reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );

  // Behavioral patterns inline (frecuentes + adherencia 7d)
  const start14d = new Date(new Date(todayStartISO).getTime() - 14 * 86400000).toISOString();
  const start7d = new Date(new Date(todayStartISO).getTime() - 7 * 86400000).toISOString();

  const { data: mealsRecent } = await supabase
    .from("meal_logs")
    .select("items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, ts")
    .eq("user_id", userId)
    .gte("ts", start14d)
    .lt("ts", todayStartISO);

  const { data: workoutsRecent } = await supabase
    .from("workout_logs")
    .select("type, ts")
    .eq("user_id", userId)
    .gte("ts", start14d)
    .lt("ts", todayStartISO);

  // Adherencia últimos 7d
  const meals7d = (mealsRecent || []).filter((m: any) => m.ts >= start7d);
  const byDay7d = new Map<string, { kcal: number; protein: number; meals: number }>();
  for (const m of meals7d) {
    const day = String(m.ts).slice(0, 10);
    const e = byDay7d.get(day) || { kcal: 0, protein: 0, meals: 0 };
    e.kcal += m.total_kcal || 0;
    e.protein += m.total_protein_g || 0;
    e.meals++;
    byDay7d.set(day, e);
  }
  const daysWithMeals = Array.from(byDay7d.values()).filter((d) => d.meals > 0).length;
  const kcalAvg7d = daysWithMeals > 0
    ? Math.round(
        Array.from(byDay7d.values()).reduce((s, d) => s + d.kcal, 0) / daysWithMeals,
      )
    : null;
  const proteinAvg7d = daysWithMeals > 0
    ? Math.round(
        Array.from(byDay7d.values()).reduce((s, d) => s + d.protein, 0) / daysWithMeals,
      )
    : null;

  const behavioralPatterns = {
    frequent_meals_count: mealsRecent?.length || 0,
    workouts_last_14d: workoutsRecent?.length || 0,
    days_with_meals_7d: daysWithMeals,
    kcal_avg_7d: kcalAvg7d,
    protein_avg_7d: proteinAvg7d,
  };

  // ─── Bug D fix: data histórica para insight de TRANSFORMACIÓN ────────
  // Cargamos ventanas de 90 días y comparamos primera mitad vs segunda mitad
  // (Identity) y calculamos slope semanal del peso (Trajectory).
  const start90d = new Date(new Date(todayStartISO).getTime() - 90 * 86400000).toISOString();
  const [mealsHistRes, workoutsHistRes, bodyCompHistRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("total_kcal, total_protein_g, ts")
      .eq("user_id", userId)
      .gte("ts", start90d)
      .lt("ts", todayStartISO)
      .order("ts", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("ts")
      .eq("user_id", userId)
      .gte("ts", start90d)
      .lt("ts", todayStartISO),
    supabase
      .from("body_compositions")
      .select("weight_kg, body_fat_pct, recorded_at")
      .eq("patient_user_id", userId)
      .gte("recorded_at", start90d)
      .order("recorded_at", { ascending: true }),
  ]);
  const mealsHist = mealsHistRes.data || [];
  const workoutsHist = workoutsHistRes.data || [];
  const bodyCompHist = bodyCompHistRes.data || [];

  // Determinar ventana "first" (primeras 4 sem) vs "recent" (últimas 4 sem).
  // Solo si hay ≥60 días entre el primer registro y hoy podemos hacer Identity.
  const allTs: number[] = [];
  for (const m of mealsHist) allTs.push(new Date(m.ts).getTime());
  for (const w of workoutsHist) allTs.push(new Date(w.ts).getTime());
  for (const b of bodyCompHist) allTs.push(new Date(b.recorded_at).getTime());
  const earliestTs = allTs.length > 0 ? Math.min(...allTs) : Date.now();
  const daysActive = Math.floor((Date.now() - earliestTs) / 86400000);
  const hasIdentityData = daysActive >= 60;

  let workoutsPerWeekFirst: number | null = null;
  let workoutsPerWeekRecent: number | null = null;
  let kcalAvgFirst: number | null = null;
  let kcalAvgRecent: number | null = null;
  let proteinAvgFirst: number | null = null;
  let proteinAvgRecent: number | null = null;
  if (hasIdentityData) {
    const firstWindowEnd = earliestTs + 28 * 86400000;
    const recentWindowStart = Date.now() - 28 * 86400000;
    const wkFirst = workoutsHist.filter((w: any) =>
      new Date(w.ts).getTime() <= firstWindowEnd,
    ).length;
    const wkRecent = workoutsHist.filter((w: any) =>
      new Date(w.ts).getTime() >= recentWindowStart,
    ).length;
    workoutsPerWeekFirst = Math.round((wkFirst / 4) * 10) / 10;
    workoutsPerWeekRecent = Math.round((wkRecent / 4) * 10) / 10;

    const mealsFirst = mealsHist.filter((m: any) =>
      new Date(m.ts).getTime() <= firstWindowEnd,
    );
    const mealsRecentH = mealsHist.filter((m: any) =>
      new Date(m.ts).getTime() >= recentWindowStart,
    );
    const sumK = (arr: any[]) => arr.reduce((s, m) => s + (m.total_kcal || 0), 0);
    const sumP = (arr: any[]) => arr.reduce((s, m) => s + (m.total_protein_g || 0), 0);
    const dayCountFirst = new Set(mealsFirst.map((m: any) => String(m.ts).slice(0, 10))).size;
    const dayCountRecent = new Set(mealsRecentH.map((m: any) => String(m.ts).slice(0, 10))).size;
    if (dayCountFirst > 0) {
      kcalAvgFirst = Math.round(sumK(mealsFirst) / dayCountFirst);
      proteinAvgFirst = Math.round(sumP(mealsFirst) / dayCountFirst);
    }
    if (dayCountRecent > 0) {
      kcalAvgRecent = Math.round(sumK(mealsRecentH) / dayCountRecent);
      proteinAvgRecent = Math.round(sumP(mealsRecentH) / dayCountRecent);
    }
  }

  // Trajectory: slope del peso usando regresión lineal sobre body_compositions
  // de los últimos 21+ días. Solo si hay ≥3 puntos y span ≥21 días.
  let weightFirst: number | null = null;
  let weightRecent: number | null = null;
  let weightSlopePerWeek: number | null = null;
  let bodyFatFirst: number | null = null;
  let bodyFatRecent: number | null = null;
  const bcWithWeight = bodyCompHist.filter((b: any) => typeof b.weight_kg === "number");
  let hasTrajectoryData = false;
  if (bcWithWeight.length >= 3) {
    const firstBc = bcWithWeight[0];
    const lastBc = bcWithWeight[bcWithWeight.length - 1];
    const spanDays =
      (new Date(lastBc.recorded_at).getTime() - new Date(firstBc.recorded_at).getTime()) /
      86400000;
    if (spanDays >= 21) {
      hasTrajectoryData = true;
      weightFirst = firstBc.weight_kg;
      weightRecent = lastBc.weight_kg;
      bodyFatFirst = typeof firstBc.body_fat_pct === "number" ? firstBc.body_fat_pct : null;
      bodyFatRecent = typeof lastBc.body_fat_pct === "number" ? lastBc.body_fat_pct : null;
      // Regresión lineal simple: pendiente kg/día → kg/semana
      const xs = bcWithWeight.map(
        (b: any) =>
          (new Date(b.recorded_at).getTime() - new Date(firstBc.recorded_at).getTime()) /
          86400000,
      );
      const ys = bcWithWeight.map((b: any) => b.weight_kg);
      const n = xs.length;
      const meanX = xs.reduce((s, v) => s + v, 0) / n;
      const meanY = ys.reduce((s, v) => s + v, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - meanX) * (ys[i] - meanY);
        den += (xs[i] - meanX) ** 2;
      }
      const slopePerDay = den > 0 ? num / den : 0;
      weightSlopePerWeek = Math.round(slopePerDay * 7 * 100) / 100; // 2 decimals
    }
  }

  const transformationArc = {
    days_active: daysActive,
    workouts_per_week_first: workoutsPerWeekFirst,
    workouts_per_week_recent: workoutsPerWeekRecent,
    kcal_avg_first: kcalAvgFirst,
    kcal_avg_recent: kcalAvgRecent,
    protein_avg_first: proteinAvgFirst,
    protein_avg_recent: proteinAvgRecent,
    weight_first: weightFirst,
    weight_recent: weightRecent,
    weight_slope_per_week: weightSlopePerWeek,
    body_fat_first: bodyFatFirst,
    body_fat_recent: bodyFatRecent,
    has_identity_data: hasIdentityData,
    has_trajectory_data: hasTrajectoryData,
  };

  // Cycle phase si aplica
  let currentPhase: string | null = null;
  let cycleDay: number | null = null;
  if (
    whRes.data?.enabled &&
    ["cycle_natural", "hormonal_bc"].includes(whRes.data?.status) &&
    whRes.data?.last_period_start_date
  ) {
    const cycleLen = whRes.data.avg_cycle_length_days || 28;
    const periodLen = whRes.data.avg_period_length_days || 5;
    const last = new Date(whRes.data.last_period_start_date + "T00:00:00");
    const today = new Date(todayISO + "T00:00:00");
    const diffDays = Math.floor((today.getTime() - last.getTime()) / 86400000);
    if (diffDays >= 0) {
      cycleDay = (diffDays % cycleLen) + 1;
      if (cycleDay <= periodLen) currentPhase = "menstrual";
      else {
        const ovulationDay = cycleLen - 14;
        if (cycleDay < ovulationDay - 2) currentPhase = "follicular";
        else if (cycleDay <= ovulationDay + 2) currentPhase = "ovulatory";
        else {
          const lutealMid = Math.floor((ovulationDay + 3 + cycleLen) / 2);
          currentPhase = cycleDay <= lutealMid ? "luteal_early" : "luteal_late";
        }
      }
    }
  }

  return {
    hourLocal,
    dayOfWeek,
    todayISO,
    todayStartISO,
    healthTwin,
    behavioralPatterns,
    todayMeals,
    todayWorkouts,
    todayHydrationMl,
    todayTargets: dailyRes.data,
    recentInBody: inBodyRes.data,
    whProfile: whRes.data,
    whTodayLog: whLogRes.data,
    currentPhase,
    cycleDay,
    transformationArc,
  };
}

// ─── Selector de categoría personalizado por lifestyle ───────────────

function selectCategory(
  ctx: PulseContext,
  recentPulses: Array<{ category: string; created_at: string }>,
  pulseType: string = "daily",
): { category: string; reason: string } {
  const now = Date.now();
  const hadCategoryWithinHours = (cat: string, hours: number): boolean => {
    return recentPulses.some(
      (p) =>
        p.category === cat &&
        now - new Date(p.created_at).getTime() < hours * 3600 * 1000,
    );
  };
  const hadCategoryToday = (cat: string): boolean => {
    return recentPulses.some(
      (p) =>
        p.category === cat &&
        String(p.created_at).slice(0, 10) === ctx.todayISO,
    );
  };

  // ─── 0. TRANSFORMATION_ARC: foco de SAVIA (cambio/evolución). ───────
  // Prioridad alta en weekly review o cuando el user tiene data histórica suficiente
  // y no recibió un transformation_arc en los últimos 7 días.
  const ta = ctx.transformationArc;
  const hasTransformationData = ta && (ta.has_identity_data || ta.has_trajectory_data);
  if (
    hasTransformationData &&
    !hadCategoryWithinHours("transformation_arc", 7 * 24)
  ) {
    // Weekly pulse: SIEMPRE elige transformation_arc si hay data.
    if (pulseType === "weekly") {
      return {
        category: "transformation_arc",
        reason: `Weekly review + data histórica (${ta.days_active}d activos)`,
      };
    }
    // Daily pulse: solo el domingo (cierre de semana) y solo si no hubo otro insight de transformación en 7d.
    if (ctx.dayOfWeek === 0 && ctx.hourLocal >= 9) {
      return {
        category: "transformation_arc",
        reason: `Domingo + ${ta.days_active}d activos`,
      };
    }
  }

  // ─── 1. POST_WORKOUT: si hay workout en últimas 2h ───
  const recentWorkout = ctx.todayWorkouts.find((w: any) => {
    if (!w.ts) return false;
    const hoursAgo = (now - new Date(w.ts).getTime()) / 3600000;
    return hoursAgo >= 0 && hoursAgo <= 2;
  });
  if (recentWorkout && !hadCategoryWithinHours("post_workout", 4)) {
    return {
      category: "post_workout",
      reason: `Workout ${recentWorkout.type} hace <2h`,
    };
  }

  // ─── 2. BODY_COMP: InBody nuevo (24h) ───
  if (
    ctx.recentInBody &&
    ctx.recentInBody.recorded_at &&
    (now - new Date(ctx.recentInBody.recorded_at).getTime()) / 3600000 < 24 &&
    !hadCategoryWithinHours("body_comp", 48)
  ) {
    return { category: "body_comp", reason: "InBody en últimas 24h" };
  }

  // ─── 3. HORMONAL: WH activado + fase relevante ───
  if (
    ctx.whProfile?.enabled &&
    ctx.currentPhase &&
    ["ovulatory", "luteal_late", "menstrual"].includes(ctx.currentPhase) &&
    !hadCategoryWithinHours("hormonal", 24)
  ) {
    return {
      category: "hormonal",
      reason: `Fase ${ctx.currentPhase}, día ${ctx.cycleDay}`,
    };
  }

  // ─── 4. TRAINING_PREP: hoy es training_day Y dentro de 2h del training_time ───
  const lifestyle = ctx.healthTwin?.lifestyle || {};
  const trainingDays: string[] = Array.isArray(lifestyle.training_days)
    ? lifestyle.training_days
    : [];
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDayName = dayNames[ctx.dayOfWeek];
  const isTrainingDayToday = trainingDays.length === 0
    ? false  // si no especificó días, NO asumir todos
    : trainingDays.map((d) => d.toLowerCase().slice(0, 3)).includes(todayDayName);

  if (isTrainingDayToday && lifestyle.training_time) {
    // Window real cuando la gente entrena en cada periodo del día.
    // Pre-window arranca 1h antes del inicio del periodo y termina 1h antes
    // del fin (cubriendo el periodo donde es útil "anuncia/prepará tu entreno").
    const trainingWindow: Record<string, [number, number]> = {
      morning: [6, 10],   // entrenan 6-10am
      midday: [11, 14],
      evening: [17, 21],
    };
    const window = trainingWindow[lifestyle.training_time];
    if (window) {
      const preWindowStart = Math.max(0, window[0] - 1); // 1h antes
      const preWindowEnd = window[1] - 1;                // hasta 1h antes del fin
      if (
        ctx.hourLocal >= preWindowStart &&
        ctx.hourLocal <= preWindowEnd &&
        ctx.todayWorkouts.length === 0 && // todavía no entrenó
        !hadCategoryWithinHours("training_prep", 3)
      ) {
        return {
          category: "training_prep",
          reason: `Hoy ${todayDayName} es training_day (${lifestyle.training_time}), hora ${ctx.hourLocal}h dentro del pre-window`,
        };
      }
    }
  }

  // ─── 5. RECOVERY: mañana temprano (5-10am), sin recovery hoy ───
  if (ctx.hourLocal >= 5 && ctx.hourLocal < 11 && !hadCategoryToday("recovery")) {
    return { category: "recovery", reason: "Mañana (5-11am), sin recovery insight hoy" };
  }

  // ─── 6. NUTRITION: hora activa (11am-9pm) Y hay data del día Y no hubo nutrition hace 4h ───
  if (
    ctx.hourLocal >= 11 &&
    ctx.hourLocal < 21 &&
    !hadCategoryWithinHours("nutrition", 4)
  ) {
    const hasNutritionData = ctx.todayMeals.length > 0 || ctx.todayTargets;
    if (hasNutritionData) {
      return { category: "nutrition", reason: "Hora activa + data nutricional disponible" };
    }
  }

  // ─── 7. BEHAVIORAL: fallback si hay pattern + no hubo behavioral en 8h ───
  if (
    !hadCategoryWithinHours("behavioral", 8) &&
    (ctx.behavioralPatterns.frequent_meals_count > 2 ||
      ctx.behavioralPatterns.workouts_last_14d > 2 ||
      ctx.behavioralPatterns.kcal_avg_7d != null)
  ) {
    return { category: "behavioral", reason: "Fallback con pattern disponible" };
  }

  // ─── Último recurso ───
  return { category: "nutrition", reason: "Default" };
}

// ─── Prompt builder por categoría ───────────────────────────────────

function buildPulsePrompt(category: string, ctx: PulseContext, pulseType: string = "daily"): string {
  const config = CATEGORY_CONFIG[category];
  const name = ctx.healthTwin?.identity?.name?.split(" ")[0] || "usuario";

  // ─── Marco temporal según pulse_type ───
  // Cada tipo cambia el TONO y FOCO del insight, no la categoría.
  const typeFraming: Record<string, string> = {
    morning: `# MARCO: MORNING PULSE
Es la mañana de ${name}. El día arranca. El insight debe:
- Orientar la jornada: qué priorizar HOY según recovery, fase, objetivos, patrones.
- Ser propositivo, no analítico. Forward-looking. "Hoy te conviene…" no "ayer hiciste…".
- Aterrizar UNA intención concreta. No abrir cinco frentes.
- Si hay déficit de sueño/HRV bajo/fase folicular tardía, el morning pulse es el momento de avisarlo.`,
    evening: `# MARCO: EVENING PULSE
Es el cierre del día de ${name}. El insight debe:
- Cerrar el día, no abrir uno nuevo. Reflexivo.
- Reconocer lo que se hizo bien (sin halago vacío) y nombrar UN ajuste.
- Si quedó déficit fuerte de proteína/agua, sugerir un cierre concreto (snack PM, vaso de agua).
- Preparar el siguiente día solo si hay algo crítico (entreno mañana, recovery comprometida).`,
    weekly: `# MARCO: WEEKLY REVIEW
Es el cierre de semana. El insight debe:
- Cruzar la semana entera, no el día.
- Nombrar UN patrón emergente y UNA palanca concreta para la siguiente semana.
- Conectar al objetivo principal explícitamente.`,
    daily: `# MARCO: DAILY PULSE
Insight contextual al momento. Usá la hora local para calibrar (mañana = orientador, tarde = ajuste, noche = cierre).`,
  };
  const framing = typeFraming[pulseType] || typeFraming.daily;

  // Goals primarios
  const goals = Array.isArray(ctx.healthTwin?.goals) ? ctx.healthTwin.goals : [];
  const activeGoals = goals.filter((g: any) => !g.status || g.status === "active");
  const goalLine = activeGoals.length > 0
    ? activeGoals.map((g: any) => g.name + (g.target ? ` (${g.target})` : "")).join(", ")
    : "no definidos";

  // Identity compact
  const id = ctx.healthTwin?.identity || {};
  const idBits = [];
  if (id.age) idBits.push(`${id.age}a`);
  if (id.weight_kg_current) idBits.push(`${id.weight_kg_current}kg`);
  if (id.body_fat_pct) idBits.push(`${id.body_fat_pct}% grasa`);
  if (id.lean_mass_kg) idBits.push(`${id.lean_mass_kg}kg masa magra`);

  // Today balance
  const sumKcal = ctx.todayMeals.reduce((s: number, m: any) => s + (m.total_kcal || 0), 0);
  const sumP = ctx.todayMeals.reduce((s: number, m: any) => s + (m.total_protein_g || 0), 0);
  const targets = ctx.todayTargets || ctx.healthTwin?.nutrition || {};
  const kcalTarget = targets.kcal_target || targets.kcal_target_per_day || null;
  const proteinTarget = targets.protein_target_g || null;

  // Workouts
  const workoutBits = ctx.todayWorkouts.map((w: any) =>
    `${w.type} ${w.duration_min}min ${w.intensity || ""}${w.kcal_burned ? ` ${w.kcal_burned}kcal` : ""}`
  ).join("; ") || "ninguno hoy";

  // Behavioral
  const bp = ctx.behavioralPatterns;
  const bpBits: string[] = [];
  if (bp.kcal_avg_7d) bpBits.push(`kcal 7d avg ${bp.kcal_avg_7d}`);
  if (bp.protein_avg_7d) bpBits.push(`proteína 7d avg ${bp.protein_avg_7d}g`);
  if (bp.workouts_last_14d) bpBits.push(`${bp.workouts_last_14d} workouts en 14d`);

  // Women's Health
  let whLine = "";
  if (ctx.whProfile?.enabled && ctx.currentPhase) {
    whLine = `\n- Ciclo: día ${ctx.cycleDay}, fase ${ctx.currentPhase}`;
  }

  // Bug D fix: bloque de transformación (solo presente si la categoría es transformation_arc)
  let transformationBlock = "";
  if (category === "transformation_arc") {
    const ta = ctx.transformationArc;
    const lines: string[] = [`- Días activos en SAVIA: ${ta.days_active}`];
    if (ta.has_identity_data) {
      lines.push("- DATOS PARA ÁNGULO IDENTITY (primeras 4 sem vs últimas 4 sem):");
      if (ta.workouts_per_week_first !== null && ta.workouts_per_week_recent !== null) {
        lines.push(`  - Workouts/semana: ${ta.workouts_per_week_first} → ${ta.workouts_per_week_recent}`);
      }
      if (ta.kcal_avg_first !== null && ta.kcal_avg_recent !== null) {
        lines.push(`  - kcal/día promedio: ${ta.kcal_avg_first} → ${ta.kcal_avg_recent}`);
      }
      if (ta.protein_avg_first !== null && ta.protein_avg_recent !== null) {
        lines.push(`  - proteína/día promedio: ${ta.protein_avg_first}g → ${ta.protein_avg_recent}g`);
      }
    } else {
      lines.push("- IDENTITY no disponible (< 60 días activos)");
    }
    if (ta.has_trajectory_data) {
      lines.push("- DATOS PARA ÁNGULO TRAJECTORY (regresión peso):");
      lines.push(`  - peso inicial: ${ta.weight_first}kg → actual: ${ta.weight_recent}kg`);
      if (ta.weight_slope_per_week !== null) {
        const direction = ta.weight_slope_per_week < 0 ? "bajando" : ta.weight_slope_per_week > 0 ? "subiendo" : "estable";
        lines.push(`  - tendencia: ${Math.abs(ta.weight_slope_per_week)}kg/semana (${direction})`);
      }
      if (ta.body_fat_first !== null && ta.body_fat_recent !== null) {
        lines.push(`  - body fat: ${ta.body_fat_first}% → ${ta.body_fat_recent}%`);
      }
    } else {
      lines.push("- TRAJECTORY no disponible (necesita ≥3 mediciones de peso + ≥21 días de span)");
    }
    transformationBlock = `\n# DATA DE TRANSFORMACIÓN (USAR PARA EL INSIGHT)\n${lines.join("\n")}\n`;
  }

  return `Sos SAVIA. Generá UN insight para mostrar como hero card en la pantalla Hoy de ${name}.

${framing}

${config.prompt}

# REGLAS DEL HEADLINE
- MÁXIMO 280 caracteres total.
- 2-3 frases. Densas. Sin verbosidad.
- CERO asteriscos. Cero markdown. Cero bullets.
- Español NEUTRO: nada de "mae", "qué onda", "te late", "padre", "chido", "órale", "chévere", "wey", "tuanis", "diay", "pura vida".
- Voseo consistente: "vos tenés", "tu HRV cayó", "estás corto", "vas bien".
- Cruzá ≥2 dimensiones (ej. HRV + nutrición, fase + fuerza, adherencia + objetivo).
- Acción IMPLÍCITA O EXPLÍCITA. No solo data — qué hacer con eso.
- Si solo das un número aislado, fallaste.
- Conectá al goal del usuario sutilmente cuando aplique.

# CONTEXTO DEL USUARIO
- Nombre: ${name}
- Identidad: ${idBits.join(" · ") || "incompleta"}
- Objetivos: ${goalLine}
- Lifestyle: training_time=${ctx.healthTwin?.lifestyle?.training_time || "?"}, training_days=${ctx.healthTwin?.lifestyle?.training_days?.join(",") || "?"}
- Hora local: ${ctx.hourLocal}h, día de semana: ${["dom","lun","mar","mié","jue","vie","sáb"][ctx.dayOfWeek]}

# CONSUMO DE HOY
- Comidas: ${ctx.todayMeals.length} (${Math.round(sumKcal)} kcal, ${Math.round(sumP)}g proteína)
- Workouts hoy: ${workoutBits}
- Hidratación: ${ctx.todayHydrationMl}ml
- Targets diarios: kcal ${kcalTarget || "—"}, proteína ${proteinTarget || "—"}g${whLine}

# PATRONES RECIENTES
- ${bpBits.join(" · ") || "sin patterns aún"}
${transformationBlock}
# RESPUESTA — FORMATO ESTRICTO JSON
Devolvé SOLO un JSON válido, sin texto extra antes ni después:

{
  "headline": "El insight (≤280 chars, las reglas de arriba)",
  "context_for_chat": "Brief en 1-2 frases sobre qué profundizar si el usuario abre chat desde este pulse. Es para vos misma cuando el usuario tap. Ej: 'Profundizá en el patrón HRV vs proteína de la última semana. Sugerí cambios concretos en snacks PM.'"
}`;
}
