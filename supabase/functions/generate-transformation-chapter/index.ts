// =====================================================================
// SAVIA — Generate Transformation Chapter (Sprint 3.B.ext.1)
// =====================================================================
// Genera un capítulo de la biblioteca de transformación personal del
// usuario. Sprint 1 solo procesa source_type='inbody'. La arquitectura
// está preparada para 'onboarding_baseline', 'weekly_review', etc.
//
// Filosofía no negociable:
//   - El capítulo se va a releer 1-3 años después
//   - Voz humilde, dignidad sobre fact-reporting
//   - Cero markdown, cero listas, prosa pura
//   - El user nunca ve error: si Claude falla, fallback determinístico
//
// POST body: {
//   source_type: 'inbody',
//   source_id: <body_composition_id>,
//   user_reflection?: string  (opcional, voz del usuario en el momento)
// }
// Returns: { ok: true, chapter: {...}, cached: boolean }
// =====================================================================

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.32.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;
const MAX_RETRIES = 2; // 1 try + 1 retry. No 3x exponencial.
const PROMPT_VERSION = "tc-v1.0";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
function jsonError(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

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

    const body = await req.json().catch(() => ({}));
    const sourceType: string | undefined = body?.source_type;
    const sourceId: string | undefined = body?.source_id;
    const userReflection: string | null = body?.user_reflection?.trim() || null;

    if (!sourceType || sourceType !== "inbody") {
      return jsonError(
        "Sprint 1 solo procesa source_type='inbody'. Otros tipos llegan en sprints futuros.",
      );
    }
    if (!sourceId) return jsonError("source_id es requerido");

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // ─── Verificar source y pertenencia ───
    const { data: bc, error: bcErr } = await supabaseAdmin
      .from("body_compositions")
      .select("*")
      .eq("id", sourceId)
      .eq("patient_user_id", user.id)
      .maybeSingle();
    if (bcErr || !bc) return jsonError("Source body_composition no encontrado", 404);

    // ─── Si ya existe chapter para este source, devolverlo (inmutable) ───
    const { data: existing } = await supabaseAdmin
      .from("transformation_chapters")
      .select("*")
      .eq("source_type", sourceType)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (existing) {
      return jsonResponse({ ok: true, chapter: existing, cached: true });
    }

    // ─── Cargar contexto en paralelo ───
    const [prevRes, allBcRes, htRes, targetsRes, chaptersCountRes, userRes] =
      await Promise.all([
        // Medición previa para "el arco hasta acá"
        supabaseAdmin
          .from("body_compositions")
          .select("measured_at, weight_kg, body_fat_pct, lean_body_mass_kg, muscle_mass_kg")
          .eq("patient_user_id", user.id)
          .lt("measured_at", bc.measured_at)
          .order("measured_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Todas las mediciones del user (para el arco completo, no solo previa)
        supabaseAdmin
          .from("body_compositions")
          .select("measured_at, weight_kg, body_fat_pct, lean_body_mass_kg")
          .eq("patient_user_id", user.id)
          .order("measured_at", { ascending: true }),
        // Health Twin
        supabaseAdmin
          .from("user_health_twin")
          .select("identity, goals")
          .eq("user_id", user.id)
          .maybeSingle(),
        // Targets nutricionales activos
        supabaseAdmin
          .from("nutrition_targets")
          .select("kcal, protein_g")
          .eq("user_id", user.id)
          .eq("active", true)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Conteo de chapters previos del user (para analysis_number)
        supabaseAdmin
          .from("transformation_chapters")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        // Info de signup del user
        supabaseAdmin.auth.admin.getUserById(user.id),
      ]);

    const prevBc = prevRes.data || null;
    const allBcs = allBcRes.data || [];
    const ht = htRes.data || {};
    const identity = (ht.identity as Record<string, unknown>) || {};
    const goals = Array.isArray(ht.goals) ? ht.goals : [];
    const activeGoals = goals.filter((g: any) => !g.status || g.status === "active");
    const targets = targetsRes.data || null;
    const chaptersPreviousCount = chaptersCountRes.count || 0;
    const signupAt = userRes?.data?.user?.created_at
      ? new Date(userRes.data.user.created_at)
      : new Date(bc.created_at);

    // ─── Calcular narrative_context ───
    const analysisNumber = chaptersPreviousCount + 1;
    const measuredAt = new Date(bc.measured_at);
    const daysSinceSignup = Math.max(
      0,
      Math.round((measuredAt.getTime() - signupAt.getTime()) / 86400000),
    );
    const firstBc = allBcs.length > 0 ? allBcs[0] : null;
    const daysSinceFirstMeasurement = firstBc
      ? Math.max(
          0,
          Math.round(
            (measuredAt.getTime() - new Date(firstBc.measured_at).getTime()) /
              86400000,
          ),
        )
      : 0;
    const narrativeContext = {
      analysis_number: analysisNumber,
      days_since_signup: daysSinceSignup,
      days_since_first_measurement: daysSinceFirstMeasurement,
    };

    // ─── Intentar generar con Claude (con 1 retry) ───
    let chapterContent: ChapterContent | null = null;
    let lastError: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let attempts = 0;

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const systemPrompt = buildChapterPrompt(
      bc,
      prevBc,
      allBcs,
      identity,
      activeGoals,
      targets,
      narrativeContext,
      userReflection,
    );

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      attempts = attempt;
      try {
        const message = await anthropic.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: "user", content: "Escribí el capítulo ahora." }],
        });
        inputTokens += message.usage?.input_tokens || 0;
        outputTokens += message.usage?.output_tokens || 0;

        const rawText = message.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => (b as any).text || "")
          .join("");

        const parsed = parseChapterJSON(rawText);
        if (parsed) {
          chapterContent = parsed;
          break;
        }
        lastError = "JSON parse failed: " + rawText.slice(0, 200);
      } catch (e) {
        lastError = String((e as Error)?.message || e);
        console.warn(`[tc] attempt ${attempt} failed:`, lastError);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    let generationStatus: "generated" | "deterministic_fallback" = "generated";

    // ─── GARANTÍA — si Claude falló, fallback determinístico ───
    if (!chapterContent) {
      console.warn(`[tc] all retries failed, using deterministic fallback`);
      chapterContent = buildDeterministicChapter(bc, prevBc, identity, activeGoals);
      generationStatus = "deterministic_fallback";
    }

    // ─── Persistir chapter ───
    const generationMetadata: Record<string, unknown> = {
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      attempts,
      input_tokens: inputTokens || null,
      output_tokens: outputTokens || null,
    };
    if (generationStatus === "deterministic_fallback") {
      generationMetadata.error_if_fallback = lastError;
    }

    const { data: insertedChapter, error: insErr } = await supabaseAdmin
      .from("transformation_chapters")
      .insert({
        user_id: user.id,
        source_type: sourceType,
        source_id: sourceId,
        how_you_are_today: chapterContent.how_you_are_today,
        arc_until_now: chapterContent.arc_until_now,
        what_this_moment_means: chapterContent.what_this_moment_means,
        where_i_invite_you: chapterContent.where_i_invite_you,
        user_reflection: userReflection,
        cover_image_url: null, // Sprint 2
        goals_snapshot: { goals: activeGoals },
        identity_snapshot: identity,
        narrative_context: narrativeContext,
        generation_status: generationStatus,
        generation_metadata: generationMetadata,
      })
      .select("*")
      .single();

    if (insErr) {
      // Race condition: si otra request concurrente acaba de crear este chapter,
      // devolvemos el que ganó.
      if (insErr.code === "23505") {
        const { data: raced } = await supabaseAdmin
          .from("transformation_chapters")
          .select("*")
          .eq("source_type", sourceType)
          .eq("source_id", sourceId)
          .maybeSingle();
        if (raced) return jsonResponse({ ok: true, chapter: raced, cached: true });
      }
      console.error("[tc] insert error:", insErr);
      return jsonError("Failed to save chapter: " + insErr.message, 500);
    }

    return jsonResponse({ ok: true, chapter: insertedChapter, cached: false });
  } catch (err) {
    console.error("[tc] fatal:", err);
    return jsonError(String((err as Error)?.message || err), 500);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface ChapterContent {
  how_you_are_today: string;
  arc_until_now: string | null;
  what_this_moment_means: string | null;
  where_i_invite_you: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────

function buildChapterPrompt(
  bc: any,
  prevBc: any | null,
  allBcs: any[],
  identity: Record<string, unknown>,
  activeGoals: any[],
  targets: any,
  narrativeContext: { analysis_number: number; days_since_signup: number; days_since_first_measurement: number },
  userReflection: string | null,
): string {
  const name = (identity?.name as string)?.split(" ")[0] || "el usuario";
  const sex = identity?.sex || "—";
  const age = identity?.age || "—";
  const level = identity?.level || "—";
  const originStory = identity?.origin_story as string | undefined;

  // Goals line
  const goalsLine = activeGoals.length > 0
    ? "Sus objetivos hoy: " +
      activeGoals.map((g: any) => `${g.name}${g.target ? ` (${g.target})` : ""}`).join("; ") +
      "."
    : `${name} aún no tiene goals registrados.`;
  const originStoryLine = originStory
    ? `Lo que ${name} dijo que la trajo a SAVIA: "${originStory}"`
    : "";

  // Métricas actuales (solo las que existen)
  const currentBits: string[] = [];
  if (bc.weight_kg) currentBits.push(`Peso ${Number(bc.weight_kg).toFixed(1)} kg`);
  if (bc.body_fat_pct) currentBits.push(`Grasa ${Number(bc.body_fat_pct).toFixed(1)}%`);
  if (bc.lean_body_mass_kg) currentBits.push(`Masa magra ${Number(bc.lean_body_mass_kg).toFixed(1)} kg`);
  if (bc.muscle_mass_kg) currentBits.push(`Músculo ${Number(bc.muscle_mass_kg).toFixed(1)} kg`);
  if (bc.visceral_fat_level) currentBits.push(`Grasa visceral ${bc.visceral_fat_level}`);
  if (bc.bmr_kcal) currentBits.push(`BMR ${bc.bmr_kcal} kcal`);
  if (bc.total_body_water_kg) currentBits.push(`Agua corporal ${Number(bc.total_body_water_kg).toFixed(1)} kg`);
  const currentMetricsBlock = currentBits.length > 0
    ? currentBits.join(" · ")
    : "datos limitados en esta medición";

  // Sección de medición previa
  let previousSection = "";
  if (prevBc) {
    const daysSincePrev = Math.round(
      (new Date(bc.measured_at).getTime() - new Date(prevBc.measured_at).getTime()) /
        86400000,
    );
    const deltas: string[] = [];
    if (bc.weight_kg && prevBc.weight_kg) {
      const d = Number(bc.weight_kg) - Number(prevBc.weight_kg);
      deltas.push(`peso ${d >= 0 ? "+" : ""}${d.toFixed(1)} kg (de ${Number(prevBc.weight_kg).toFixed(1)} a ${Number(bc.weight_kg).toFixed(1)})`);
    }
    if (bc.body_fat_pct && prevBc.body_fat_pct) {
      const d = Number(bc.body_fat_pct) - Number(prevBc.body_fat_pct);
      deltas.push(`grasa ${d >= 0 ? "+" : ""}${d.toFixed(1)} pp (de ${Number(prevBc.body_fat_pct).toFixed(1)}% a ${Number(bc.body_fat_pct).toFixed(1)}%)`);
    }
    if (bc.lean_body_mass_kg && prevBc.lean_body_mass_kg) {
      const d = Number(bc.lean_body_mass_kg) - Number(prevBc.lean_body_mass_kg);
      deltas.push(`masa magra ${d >= 0 ? "+" : ""}${d.toFixed(1)} kg`);
    }
    previousSection = `Medición previa hace ${daysSincePrev} día${daysSincePrev === 1 ? "" : "s"}: ${deltas.join(", ")}.`;
  }

  // Arco completo: si hay >= 3 mediciones, presentar la serie completa
  let arcSection = "";
  if (allBcs.length >= 2) {
    const seriesLines = allBcs
      .filter((m: any) => m.weight_kg !== null && m.weight_kg !== undefined)
      .map((m: any) => {
        const date = new Date(m.measured_at).toISOString().split("T")[0];
        const bits: string[] = [`${date}`];
        if (m.weight_kg) bits.push(`${Number(m.weight_kg).toFixed(1)} kg`);
        if (m.body_fat_pct) bits.push(`${Number(m.body_fat_pct).toFixed(1)}% grasa`);
        if (m.lean_body_mass_kg) bits.push(`${Number(m.lean_body_mass_kg).toFixed(1)} kg magra`);
        return bits.join(" · ");
      })
      .join("\n");
    arcSection = `Arco completo de mediciones registradas:\n${seriesLines}`;
  }

  const firstMeasurementLine = narrativeContext.days_since_first_measurement > 0
    ? `${narrativeContext.days_since_first_measurement} días desde su primera medición corporal.`
    : "Esta es su primera medición corporal con SAVIA.";

  const measuredAtHuman = new Date(bc.measured_at).toLocaleDateString("es-CR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const userReflectionSection = userReflection
    ? `Antes de subir esta medición, ${name} escribió:\n"${userReflection}"`
    : "";

  const targetsLine = targets
    ? `Targets nutricionales activos: kcal ${targets.kcal}, proteína ${targets.protein_g}g.`
    : "Sin targets nutricionales activos.";

  return `Sos SAVIA. Estás escribiendo un capítulo en la biblioteca personal de transformación de ${name}. Este texto va a quedar en su historial para siempre — es un capítulo, no un reporte.

## La promesa que estás cumpliendo

${name} va a releer este capítulo en 1, 2 o 3 años. Cuando lo haga, no va a buscar métricas ni recomendaciones técnicas. Va a buscar reconocerse en este momento. Va a buscar sentir que cuando estuvo en este punto de su transformación, alguien observó con cuidado y respeto.

Tu tarea no es analizar un InBody. Tu tarea es escribir un capítulo de su biografía corporal.

## Voz no negociable

Sos observadora cuidadosa, no oráculo. Decís "observo", "noto", "los datos sugieren", "este patrón podría indicar". NO decís "estás claramente en X", "es evidente que Y", "te faltan 8 semanas para Z".

Priorizás dignidad sobre fact-reporting. Si los datos son difíciles (estancamiento, retroceso, frustración del user), enmarcás con compasión sin mentir. Un capítulo nunca debe lastimar al user releerlo. Un capítulo puede ser honesto sobre un momento difícil sin ser cruel.

Tono coach personal, no profesional médica. Sin lenguaje clínico (diagnóstico, condición, paciente). Sin lenguaje fitness-ego (transformación radical, imparable, máquina). Sin aspiracionalismo vacío.

Español neutro con voseo. Cero slang: nada de "mae", "qué onda", "te late", "padre", "chido", "órale", "chévere", "wey", "tuanis", "diay", "pura vida".

CERO markdown. CERO listas. CERO bullets. CERO asteriscos. CERO negritas. Solo párrafos de prosa fluida.

## Contexto del momento

${name} es ${sex}, ${age} años, nivel ${level}.
${goalsLine}
${originStoryLine}
${targetsLine}

## Datos del momento

Este es el capítulo número ${narrativeContext.analysis_number} de su biblioteca con SAVIA.
${narrativeContext.days_since_signup} días desde que empezó esta relación.
${firstMeasurementLine}

Medición actual (${bc.method}, ${measuredAtHuman}):
${currentMetricsBlock}

${previousSection}

${arcSection}

${userReflectionSection}

## Las cuatro secciones del capítulo

Cada sección es 2-4 frases densas. Sin headers, sin numeración — el cliente las renderiza con separación tipográfica sutil.

### 1. how_you_are_today — Cómo estás hoy

Describí el cuerpo de ${name} en este momento. NO recitando métricas como reporte: narrando como observadora que mira con cuidado. Mencioná lo más relevante de su composición actual con voz humana. Si ${name} dejó reflexión antes de subir, hacé eco sutil sin replicar literal.

### 2. arc_until_now — El arco hasta acá

Contá la historia corporal hasta este momento. NO solo qué cambió desde la última medición: todo el arco visible. Dónde empezó, cómo fluctuó, dónde quedó hoy. Si hay tendencia, nombrala. Si hay meseta, nombrala. Si hay etapas, contalas. SI esta es la primera medición del usuario (no hay arco previo), devolvé null (no inventes arco).

### 3. what_this_moment_means — Lo que este momento significa

Interpretación narrativa, no clínica. ¿Es un punto de inflexión? ¿Una meseta esperada? ¿Una consolidación? ¿Una recuperación? Conectá sutilmente al goal activo SI hay uno. NO digás "estás a X% de tu meta" ni "te faltan N semanas" — ese lenguaje es transaccional. Decí qué SIGNIFICA narrativamente este momento en su transformación. SI no hay goals activos o si es su primer capítulo, devolvé null.

### 4. where_i_invite_you — Hacia dónde te invito

Una invitación breve a la próxima exploración. NO prescripción ("debés hacer X"). NO checklist. Tono coach personal. 2-3 frases con UNA o DOS ideas concretas pero abiertas. Lenguaje suave: "te invito a", "te propongo explorar", "considerá".

## Restricciones de honestidad

Si la tendencia es positiva: nombrala sin exagerar.
Si la tendencia es ambigua o estancada: nombrala con respeto.
Si la tendencia es negativa: enmarcala con dignidad. NUNCA "vas mal" ni "perdiste terreno". Sí "este es un período más difícil" o "los números no se mueven en la dirección que buscás, y eso forma parte".

Predicciones SIEMPRE soft. Cero "te faltan X semanas". Sí "si la tendencia reciente continúa, seguís acercándote a tu objetivo".

NUNCA inventes datos. Si no sabés algo, NO lo digas.

## Output

Devolvé SOLO un JSON estricto. Sin texto antes ni después. Sin fenced code blocks.

{
  "how_you_are_today": "...",
  "arc_until_now": "..." o null,
  "what_this_moment_means": "..." o null,
  "where_i_invite_you": "..."
}`;
}

// ─────────────────────────────────────────────────────────────────────
// JSON parser robusto
// ─────────────────────────────────────────────────────────────────────

function parseChapterJSON(text: string): ChapterContent | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      const obj = JSON.parse(fenced[1]);
      if (isValidChapter(obj)) return normalizeChapter(obj);
    } catch (_) {}
  }
  const matches = text.match(/\{[\s\S]*\}/);
  if (matches) {
    try {
      const obj = JSON.parse(matches[0]);
      if (isValidChapter(obj)) return normalizeChapter(obj);
    } catch (_) {}
  }
  return null;
}

function isValidChapter(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.how_you_are_today !== "string") return false;
  if (obj.how_you_are_today.trim().length < 30) return false;
  return true;
}

function normalizeChapter(obj: any): ChapterContent {
  const clean = (s: any): string | null => {
    if (s === null || s === undefined) return null;
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (t.length === 0) return null;
    return t
      .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
      .replace(/\*([^*\n]+?)\*/g, "$1")
      .replace(/__([\s\S]*?)__/g, "$1")
      .replace(/_([^_\n]+?)_/g, "$1");
  };
  return {
    how_you_are_today: clean(obj.how_you_are_today) || "Tu medición quedó registrada.",
    arc_until_now: clean(obj.arc_until_now),
    what_this_moment_means: clean(obj.what_this_moment_means),
    where_i_invite_you: clean(obj.where_i_invite_you),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic fallback (server-side, sin LLM)
// ─────────────────────────────────────────────────────────────────────
// La garantía: si Claude falla los retries, generamos un capítulo
// digno con templates. El user nunca ve error.

function buildDeterministicChapter(
  bc: any,
  prevBc: any | null,
  _identity: Record<string, unknown>,
  activeGoals: any[],
): ChapterContent {
  const bits: string[] = [];
  if (bc.weight_kg) bits.push(`Tu peso quedó en ${Number(bc.weight_kg).toFixed(1)} kg`);
  if (bc.body_fat_pct) bits.push(`tu grasa corporal en ${Number(bc.body_fat_pct).toFixed(1)}%`);
  if (bc.lean_body_mass_kg) bits.push(`tu masa magra en ${Number(bc.lean_body_mass_kg).toFixed(1)} kg`);

  const how = bits.length > 0
    ? `${bits.join(", ")}. Esta medición quedó registrada como un nuevo capítulo en tu historial.`
    : "Tu nueva medición quedó registrada como un nuevo capítulo en tu historial. Las métricas extraídas se ven en el detalle.";

  let arc: string | null = null;
  if (prevBc) {
    const daysSince = Math.round(
      (new Date(bc.measured_at).getTime() - new Date(prevBc.measured_at).getTime()) /
        86400000,
    );
    const trendBits: string[] = [];
    if (bc.weight_kg && prevBc.weight_kg) {
      const d = Number(bc.weight_kg) - Number(prevBc.weight_kg);
      const verb = d < -0.1 ? "bajó" : d > 0.1 ? "subió" : "se mantuvo";
      trendBits.push(`tu peso ${verb} ${Math.abs(d).toFixed(1)} kg`);
    }
    if (bc.body_fat_pct && prevBc.body_fat_pct) {
      const d = Number(bc.body_fat_pct) - Number(prevBc.body_fat_pct);
      const verb = d < -0.1 ? "bajó" : d > 0.1 ? "subió" : "se mantuvo";
      trendBits.push(`tu grasa ${verb} ${Math.abs(d).toFixed(1)} pp`);
    }
    if (bc.lean_body_mass_kg && prevBc.lean_body_mass_kg) {
      const d = Number(bc.lean_body_mass_kg) - Number(prevBc.lean_body_mass_kg);
      const verb = d < -0.1 ? "bajó" : d > 0.1 ? "subió" : "se mantuvo";
      trendBits.push(`tu masa magra ${verb} ${Math.abs(d).toFixed(1)} kg`);
    }
    arc = trendBits.length > 0
      ? `En los ${daysSince} día${daysSince === 1 ? "" : "s"} desde tu medición anterior, ${trendBits.join(", ")}. Cada medición que registrás se vuelve parte del arco que SAVIA va observando con vos.`
      : `Esta medición está separada por ${daysSince} día${daysSince === 1 ? "" : "s"} de la previa, y se suma al patrón que SAVIA va leyendo a lo largo de tu transformación.`;
  }

  let alignment: string | null = null;
  if (activeGoals.length > 0) {
    const names = activeGoals.slice(0, 2).map((g: any) => g.name).join(" y ");
    alignment = `Tus objetivos activos siguen siendo ${names}. Este registro se suma al patrón que SAVIA va observando con vos. En tu próxima conversación con SAVIA podés profundizar en cómo esta medición se conecta con ese objetivo.`;
  }

  const invite = "Te invito a seguir registrando con la misma regularidad. La consistencia en las mediciones es lo que hace que la historia de tu cuerpo tenga señal real. Cuando quieras conversar sobre los detalles o cómo afecta tu plan, abrime el chat y conversamos.";

  return {
    how_you_are_today: how,
    arc_until_now: arc,
    what_this_moment_means: alignment,
    where_i_invite_you: invite,
  };
}
