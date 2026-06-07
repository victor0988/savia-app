// SAVIA Coach — AI Chat Stream Edge Function
// Sprint 1.2: Anthropic Haiku + Context Builder + SSE streaming
//
// Deploy: supabase functions deploy ai-chat-stream
// Secrets needed: ANTHROPIC_API_KEY (ya configurado), SUPABASE_SERVICE_ROLE_KEY
//
// Body: { thread_id?: string, message: string }
// Response: SSE stream with events: meta | delta | done | error

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const MAX_HISTORY = 20; // últimos N mensajes que enviamos al modelo

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("Missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !supabaseAnon || !serviceKey || !anthropicKey) {
      return jsonError("Server misconfigured (missing env)", 500);
    }

    // Auth-scoped client (verifica JWT)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) {
      return jsonError("Unauthorized", 401);
    }

    // Service-role client (lectura de contexto sin RLS, escritura de mensajes)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Body
    const body = await req.json().catch(() => null);
    if (!body?.message || typeof body.message !== "string") {
      return jsonError("Missing or invalid 'message'", 400);
    }
    const userMessage: string = body.message.trim();
    if (!userMessage) {
      return jsonError("Empty message", 400);
    }
    if (userMessage.length > 4000) {
      return jsonError("Message too long (max 4000 chars)", 400);
    }

    // Resolve thread (get default o create new)
    let threadId: string | null = body.thread_id || null;
    if (!threadId) {
      // Buscar default thread del user
      const { data: existing } = await supabaseAdmin
        .from("coach_threads")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_default", true)
        .eq("archived", false)
        .maybeSingle();
      if (existing) {
        threadId = existing.id;
      } else {
        const { data: newThread, error: tErr } = await supabaseAdmin
          .from("coach_threads")
          .insert({ user_id: user.id, is_default: true })
          .select("id")
          .single();
        if (tErr || !newThread) {
          console.error("[ai-chat] thread create:", tErr);
          return jsonError("Failed to create thread", 500);
        }
        threadId = newThread.id;
      }
    }

    // Save user message
    const { error: insErr } = await supabaseAdmin
      .from("coach_messages")
      .insert({
        thread_id: threadId,
        user_id: user.id,
        role: "user",
        content: userMessage,
      });
    if (insErr) {
      console.error("[ai-chat] insert user msg:", insErr);
      return jsonError("Failed to save message", 500);
    }

    // Load thread history (incluye el mensaje recién insertado)
    const { data: historyRows } = await supabaseAdmin
      .from("coach_messages")
      .select("role, content, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY);

    const messages = (historyRows || [])
      .filter((m) =>
        m.content && (m.role === "user" || m.role === "assistant")
      )
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }));

    // Build user context (parallel queries)
    const ctx = await buildUserContext(supabaseAdmin, user.id);
    const systemPrompt = buildSystemPrompt(ctx);

    // Init Anthropic
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        try {
          // Meta event: send thread_id
          send("meta", { thread_id: threadId });

          let fullText = "";
          let inputTokens = 0;
          let outputTokens = 0;

          const anthropicStream = await anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages,
          });

          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const delta = event.delta.text;
              fullText += delta;
              send("delta", { text: delta });
            } else if (event.type === "message_delta") {
              outputTokens = event.usage?.output_tokens || outputTokens;
            } else if (event.type === "message_start") {
              inputTokens = event.message.usage?.input_tokens || 0;
            }
          }

          // Save assistant message
          await supabaseAdmin.from("coach_messages").insert({
            thread_id: threadId,
            user_id: user.id,
            role: "assistant",
            content: fullText,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          });

          send("done", {
            ok: true,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          });
          controller.close();
        } catch (err) {
          console.error("[ai-chat] stream error:", err);
          send("error", { error: String((err as Error)?.message || err) });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no", // disable buffering en proxies
      },
    });
  } catch (err) {
    console.error("[ai-chat] fatal:", err);
    return jsonError(String((err as Error)?.message || err), 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Context Builder — corre N queries en paralelo y compila state del user
// ─────────────────────────────────────────────────────────────────────

interface UserContext {
  todayISO: string;
  hour: number;
  profile: any;
  todayMacros: any;
  todayMeals: any[];
  todayWorkouts: any[];
  activePlan: any;
  whProfile: any;
  whTodayLog: any;
  recentInBody: any;
}

async function buildUserContext(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<UserContext> {
  const today = new Date();
  const todayISO = today.toISOString().split("T")[0];
  const hour = today.getHours();

  // Run in parallel
  const [
    profileRes,
    todayMacrosRes,
    todayMealsRes,
    todayWorkoutsRes,
    planRes,
    whProfileRes,
    whTodayLogRes,
    inBodyRes,
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("name, sex, age, level, goals, height_cm, weight_kg")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("daily_logs")
      .select(
        "kcal_consumed, protein_g, carbs_g, fat_g, water_ml, kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml",
      )
      .eq("user_id", userId)
      .eq("log_date", todayISO)
      .maybeSingle(),
    supabase
      .from("meal_logs")
      .select("items_text, kcal, protein_g, meal_category, logged_at")
      .eq("user_id", userId)
      .gte("logged_at", `${todayISO}T00:00:00`)
      .order("logged_at", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("activity_name, duration_min, kcal_burned, source")
      .eq("user_id", userId)
      .gte("performed_at", `${todayISO}T00:00:00`)
      .order("performed_at", { ascending: false }),
    supabase
      .from("nutrition_plans")
      .select("name, kcal_target, protein_target_g, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("women_health_profile")
      .select(
        "enabled, status, avg_cycle_length_days, avg_period_length_days, last_period_start_date, goals",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("cycle_day_logs")
      .select("flow_intensity, cramp_level, energy_level, mood, cravings")
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
  ]);

  return {
    todayISO,
    hour,
    profile: profileRes.data,
    todayMacros: todayMacrosRes.data,
    todayMeals: todayMealsRes.data || [],
    todayWorkouts: todayWorkoutsRes.data || [],
    activePlan: planRes.data,
    whProfile: whProfileRes.data,
    whTodayLog: whTodayLogRes.data,
    recentInBody: inBodyRes.data,
  };
}

// ─────────────────────────────────────────────────────────────────────
// System Prompt Builder
// ─────────────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: UserContext): string {
  const name = ctx.profile?.name?.split(" ")[0] || "amig@";
  const hourLabel = ctx.hour < 12
    ? "mañana"
    : ctx.hour < 19
    ? "tarde"
    : "noche";

  let p = `Sos SAVIA, el copiloto wellness de ${name}.

# QUÉ SOS
Un copiloto holístico que cubre nutrición, entrenamiento, sueño, recuperación y — si aplica — ciclo hormonal. Tu fuerza es CRUZAR datos: balance kcal, plan activo, workouts, recovery, y (cuando es relevante) fase del ciclo.

# ESTILO
- Español tico/centroamericano. Usás "vos", no "tú".
- Claro, cercano, sin jerga médica innecesaria.
- Sin emoji excepto que el usuario los use primero.
- Sin asteriscos para énfasis. Sin markdown headers en respuestas.
- BREVE: 1-3 oraciones idealmente. Solo expandé si el tema lo amerita.
- Sin postambles ("¿algo más?", "espero que ayude!"). Cortás cuando dijiste lo que tenías que decir.

# REGLAS DE SCOPE
- Respondé a lo que el usuario PREGUNTA. No agregues data no solicitada.
- Mencioná el ciclo SOLO si la pregunta es relevante (energía, fatiga, antojos, mood, recovery, fuerza, sueño en mujeres). Si pregunta "¿qué entreno hoy?" sin contexto hormonal, NO arranques con "estás en fase X".
- Para preguntas generales (nutrición, hidratación, comidas, entrenamiento, recovery, sueño), respondé como copiloto generalista. El ciclo es UN input, no EL input.
- Si la respuesta no requiere data del ciclo, no la traigas.

# REGLAS DE DATA
- NUNCA inventés números. Si no sabés kcal/gramos, pedí más info o decí honestamente "no tengo data de eso".
- Si el usuario pide registrar comida/agua/workout, decí: "Aún no puedo registrar — la próxima versión (Sprint 1.3) lo habilita. Por ahora puedo solo conversar y dar recomendaciones."
- Si la pregunta no tiene sentido o no tenés data, decílo honestamente.
- No dés consejo médico. Para condiciones, sugerí consultar profesional.

# CONTEXTO DE HOY
Fecha: ${ctx.todayISO} · ${ctx.hour}h (${hourLabel})
`;

  if (ctx.profile) {
    const goals = Array.isArray(ctx.profile.goals)
      ? ctx.profile.goals.join(", ")
      : "no definidos";
    p +=
      `Perfil: ${ctx.profile.name || "?"}, ${ctx.profile.sex || "?"}, ${ctx.profile.age || "?"} años, nivel ${ctx.profile.level || "?"}\n`;
    p += `Objetivos: ${goals}\n`;
    if (ctx.profile.weight_kg) p += `Peso: ${ctx.profile.weight_kg}kg`;
    if (ctx.profile.height_cm) p += ` · Altura: ${ctx.profile.height_cm}cm`;
    p += `\n`;
  }

  if (ctx.recentInBody) {
    p +=
      `Última InBody: ${ctx.recentInBody.weight_kg}kg · ${ctx.recentInBody.muscle_mass_kg}kg músculo · ${ctx.recentInBody.body_fat_pct}% grasa\n`;
  }

  if (ctx.todayMacros) {
    const m = ctx.todayMacros;
    p += `\n## Balance hoy
- Consumido: ${m.kcal_consumed || 0} kcal (P: ${m.protein_g ||
      0}g, C: ${m.carbs_g || 0}g, G: ${m.fat_g || 0}g)
- Meta: ${m.kcal_target || "—"} kcal (P: ${m.protein_target_g ||
      "—"}g, C: ${m.carbs_target_g || "—"}g, G: ${m.fat_target_g || "—"}g)
- Agua: ${m.water_ml || 0}ml de ${m.water_target_ml || "—"}ml
`;
  }

  if (ctx.todayMeals.length > 0) {
    p += `\n## Comidas registradas hoy\n`;
    ctx.todayMeals.forEach((m: any) => {
      p += `- ${m.meal_category || "?"}: ${m.items_text} (${m.kcal ||
        0}kcal, ${m.protein_g || 0}g P)\n`;
    });
  } else if (ctx.todayMacros && ctx.todayMacros.kcal_consumed > 0) {
    p +=
      `\nNota: el balance de hoy refleja registros pero no veo lista detallada de comidas.\n`;
  }

  if (ctx.todayWorkouts.length > 0) {
    p += `\n## Workouts hoy\n`;
    ctx.todayWorkouts.forEach((w: any) => {
      p += `- ${w.activity_name} · ${w.duration_min}min · ${w.kcal_burned ||
        "?"} kcal (${w.source || "manual"})\n`;
    });
  }

  if (ctx.activePlan) {
    p += `\n## Plan activo
- ${ctx.activePlan.name || "Plan personalizado"}
- Target: ${ctx.activePlan.kcal_target} kcal, ${ctx.activePlan
      .protein_target_g}g proteína
`;
  }

  // Women's Health
  if (ctx.whProfile?.enabled) {
    p += `\n## Women's Health (${ctx.whProfile.status})\n`;
    if (
      ["cycle_natural", "hormonal_bc"].includes(ctx.whProfile.status) &&
      ctx.whProfile.last_period_start_date
    ) {
      const cycleLen = ctx.whProfile.avg_cycle_length_days || 28;
      const periodLen = ctx.whProfile.avg_period_length_days || 5;
      const today = new Date(ctx.todayISO + "T12:00:00");
      const last = new Date(ctx.whProfile.last_period_start_date + "T12:00:00");
      const diffDays = Math.floor(
        (today.getTime() - last.getTime()) / 86400000,
      );
      const cycleDay = (diffDays % cycleLen) + 1;
      const ovulationDay = cycleLen - 14;
      let phase = "follicular";
      if (cycleDay <= periodLen) phase = "menstrual";
      else if (
        cycleDay >= ovulationDay - 2 &&
        cycleDay <= ovulationDay + 2
      ) phase = "ovulatory";
      else if (cycleDay > ovulationDay + 2) {
        const lutealMid = Math.floor((ovulationDay + 3 + cycleLen) / 2);
        phase = cycleDay <= lutealMid ? "luteal_early" : "luteal_late";
      }
      p +=
        `- Día del ciclo: ${cycleDay} de ${cycleLen} · Fase: **${phase}**\n`;
      const daysUntil = Math.max(0, cycleLen - cycleDay);
      p += `- Próximo período en ~${daysUntil} días\n`;
    }
    const whGoals = Array.isArray(ctx.whProfile.goals)
      ? ctx.whProfile.goals.join(", ")
      : "";
    if (whGoals) p += `- Objetivos WH: ${whGoals}\n`;
    if (ctx.whTodayLog) {
      const log = ctx.whTodayLog;
      const parts: string[] = [];
      if (log.flow_intensity) parts.push(`flujo ${log.flow_intensity}`);
      if (log.cramp_level !== null) parts.push(`cólicos ${log.cramp_level}/3`);
      if (log.energy_level) parts.push(`energía ${log.energy_level}`);
      if (log.mood) parts.push(`mood ${log.mood}`);
      if (parts.length) p += `- Log de hoy: ${parts.join(", ")}\n`;
    }
  }

  return p;
}
