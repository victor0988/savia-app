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
const MAX_TOOL_ITERATIONS = 4; // máximo de rondas de tool calling por turno

// ─────────────────────────────────────────────────────────────────────
// Tool definitions (Anthropic schema)
// ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "log_meal",
    description:
      "Registra una comida en el diario de nutrición del usuario. Usá esto cuando el usuario explícitamente pide registrar/logear/anotar una comida. Si NO tenés certeza sobre kcal o macros, NO llames esta tool — primero pedí los detalles al usuario.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Descripción de la comida (ej '200g pechuga de pollo + 150g arroz blanco')",
        },
        meal_category: {
          type: "string",
          enum: [
            "breakfast",
            "snack_am",
            "lunch",
            "snack_pm",
            "dinner",
            "post_workout",
          ],
          description: "Categoría temporal de la comida",
        },
        kcal: {
          type: "number",
          description: "Calorías totales estimadas",
        },
        protein_g: {
          type: "number",
          description: "Proteína en gramos (opcional pero recomendado)",
        },
        carbs_g: {
          type: "number",
          description: "Carbohidratos en gramos (opcional)",
        },
        fat_g: { type: "number", description: "Grasa en gramos (opcional)" },
      },
      required: ["name", "meal_category", "kcal"],
    },
  },
  {
    name: "log_water",
    description:
      "Registra hidratación del usuario. Usá esto cuando el usuario pide registrar agua/líquido. Cantidades comunes: 250ml (vaso chico), 500ml (botella chica), 750ml (botella mediana), 1000ml (botella grande).",
    input_schema: {
      type: "object",
      properties: {
        ml: {
          type: "number",
          description: "Mililitros de agua a registrar (1-3000)",
        },
      },
      required: ["ml"],
    },
  },
  {
    name: "get_balance",
    description:
      "Consulta el balance energético actualizado del usuario hoy: kcal consumidas, target, macros y hidratación. Usá esto SOLO si ya registraste algo y necesitás data fresca, o si el usuario pregunta explícitamente 'cómo voy'.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

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

    // Streaming response con tool-calling loop
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        try {
          send("meta", { thread_id: threadId });

          // Convertir history (plain user/assistant texts) al formato Anthropic
          // necesario para tool calling: cada message es { role, content } donde
          // content puede ser string O array de blocks.
          const apiMessages: any[] = messages.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let didActions = false; // si llamamos alguna tool, refresh UI
          let iterations = 0;

          while (iterations < MAX_TOOL_ITERATIONS) {
            iterations++;

            let textBuffer = "";
            const anthropicStream = await anthropic.messages.stream({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system: systemPrompt,
              tools: TOOLS as any,
              messages: apiMessages,
            });

            for await (const event of anthropicStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                const delta = event.delta.text;
                textBuffer += delta;
                send("delta", { text: delta });
              } else if (event.type === "message_start") {
                totalInputTokens += event.message.usage?.input_tokens || 0;
              } else if (event.type === "message_delta") {
                totalOutputTokens += event.usage?.output_tokens || 0;
              }
            }

            const finalMessage = await anthropicStream.finalMessage();

            // Persistir el texto del assistant si hubo
            if (textBuffer.trim()) {
              await supabaseAdmin.from("coach_messages").insert({
                thread_id: threadId,
                user_id: user.id,
                role: "assistant",
                content: textBuffer,
                input_tokens: 0,
                output_tokens: 0,
              });
            }

            // Si no hay tool calls, terminamos el loop
            if (finalMessage.stop_reason !== "tool_use") {
              break;
            }

            // Hay tool calls. Ejecutarlos.
            const toolUseBlocks = finalMessage.content.filter(
              (b: any) => b.type === "tool_use",
            );
            const toolResultsForApi: any[] = [];

            for (const block of toolUseBlocks) {
              const tu = block as any;
              didActions = true;
              send("tool_start", {
                id: tu.id,
                name: tu.name,
                input: tu.input,
              });

              const result = await executeToolByName(
                tu.name,
                tu.input,
                user.id,
                supabaseAdmin,
              );

              // Persistir el tool call + result en coach_messages
              await supabaseAdmin.from("coach_messages").insert({
                thread_id: threadId,
                user_id: user.id,
                role: "tool",
                tool_call_id: tu.id,
                tool_name: tu.name,
                tool_input: tu.input,
                tool_output: result,
                tool_error: result?.error || null,
              });

              send("tool_end", {
                id: tu.id,
                name: tu.name,
                output: result,
              });

              toolResultsForApi.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(result),
                is_error: !!result?.error,
              });
            }

            // Append a apiMessages para que Claude continúe la conversación
            apiMessages.push({
              role: "assistant",
              content: finalMessage.content,
            });
            apiMessages.push({ role: "user", content: toolResultsForApi });
          }

          send("done", {
            ok: true,
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            did_actions: didActions,
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
// Tool executors
// ─────────────────────────────────────────────────────────────────────

async function executeToolByName(
  name: string,
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  try {
    if (name === "log_meal") return await executeLogMeal(input, userId, supabase);
    if (name === "log_water") return await executeLogWater(input, userId, supabase);
    if (name === "get_balance") return await executeGetBalance(userId, supabase);
    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`[tool ${name}] error:`, err);
    return { error: String((err as Error)?.message || err) };
  }
}

async function executeLogMeal(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  if (!input?.name || !input?.meal_category || input?.kcal === undefined) {
    return { error: "Missing required: name, meal_category, kcal" };
  }
  const validCats = [
    "breakfast",
    "snack_am",
    "lunch",
    "snack_pm",
    "dinner",
    "post_workout",
  ];
  if (!validCats.includes(input.meal_category)) {
    return { error: `Invalid meal_category. Use: ${validCats.join(", ")}` };
  }
  const kcal = Number(input.kcal);
  if (isNaN(kcal) || kcal < 0 || kcal > 5000) {
    return { error: "kcal must be between 0 and 5000" };
  }
  const payload = {
    user_id: userId,
    items_text: String(input.name).slice(0, 500),
    meal_category: input.meal_category,
    total_kcal: Math.round(kcal),
    total_protein_g: input.protein_g ? Math.round(input.protein_g * 10) / 10 : 0,
    total_carbs_g: input.carbs_g ? Math.round(input.carbs_g * 10) / 10 : 0,
    total_fat_g: input.fat_g ? Math.round(input.fat_g * 10) / 10 : 0,
    source: "coach",
  };
  const { data, error } = await supabase
    .from("meal_logs")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("[log_meal] insert error:", error);
    return { error: error.message };
  }
  return {
    ok: true,
    id: data.id,
    summary: `${input.name} · ${Math.round(kcal)} kcal${
      input.protein_g ? ` · ${input.protein_g}g P` : ""
    }`,
  };
}

async function executeLogWater(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  const ml = Number(input?.ml);
  if (isNaN(ml) || ml <= 0 || ml > 3000) {
    return { error: "ml must be between 1 and 3000" };
  }
  const { data, error } = await supabase
    .from("hydration_logs")
    .insert({ user_id: userId, ml: Math.round(ml) })
    .select("id")
    .single();
  if (error) {
    console.error("[log_water] insert error:", error);
    return { error: error.message };
  }
  return { ok: true, id: data.id, summary: `+${Math.round(ml)}ml de agua` };
}

async function executeGetBalance(
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  const today = new Date().toISOString().split("T")[0];
  const [mealsRes, hydRes, dailyRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("total_kcal, total_protein_g, total_carbs_g, total_fat_g")
      .eq("user_id", userId)
      .gte("created_at", `${today}T00:00:00`),
    supabase
      .from("hydration_logs")
      .select("ml")
      .eq("user_id", userId)
      .gte("created_at", `${today}T00:00:00`),
    supabase
      .from("daily_logs")
      .select(
        "kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml",
      )
      .eq("user_id", userId)
      .eq("log_date", today)
      .maybeSingle(),
  ]);

  const meals = mealsRes.data || [];
  const kcal_consumed = meals.reduce(
    (s: number, m: any) => s + (m.total_kcal || 0),
    0,
  );
  const protein_g = meals.reduce(
    (s: number, m: any) => s + (m.total_protein_g || 0),
    0,
  );
  const carbs_g = meals.reduce(
    (s: number, m: any) => s + (m.total_carbs_g || 0),
    0,
  );
  const fat_g = meals.reduce(
    (s: number, m: any) => s + (m.total_fat_g || 0),
    0,
  );
  const water_ml = (hydRes.data || []).reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );
  const t = dailyRes.data || {};

  return {
    kcal_consumed: Math.round(kcal_consumed),
    kcal_target: t.kcal_target ?? null,
    kcal_remaining: t.kcal_target
      ? Math.max(0, Math.round(t.kcal_target - kcal_consumed))
      : null,
    protein_g: Math.round(protein_g),
    protein_target_g: t.protein_target_g ?? null,
    carbs_g: Math.round(carbs_g),
    carbs_target_g: t.carbs_target_g ?? null,
    fat_g: Math.round(fat_g),
    fat_target_g: t.fat_target_g ?? null,
    water_ml,
    water_target_ml: t.water_target_ml ?? 2500,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Context Builder — corre N queries en paralelo y compila state del user
// ─────────────────────────────────────────────────────────────────────

interface UserContext {
  todayISO: string;
  hour: number;
  profile: any;
  todayTargets: any;
  todayHydrationMl: number;
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
    todayTargetsRes,
    todayMealsRes,
    todayWorkoutsRes,
    planRes,
    whProfileRes,
    whTodayLogRes,
    inBodyRes,
    todayHydRes,
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("name, sex, age, level, goals, height_cm, weight_kg")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("daily_logs")
      .select(
        "kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml",
      )
      .eq("user_id", userId)
      .eq("log_date", todayISO)
      .maybeSingle(),
    supabase
      .from("meal_logs")
      .select(
        "items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, meal_category, created_at",
      )
      .eq("user_id", userId)
      .gte("created_at", `${todayISO}T00:00:00`)
      .order("created_at", { ascending: true }),
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
    supabase
      .from("hydration_logs")
      .select("ml")
      .eq("user_id", userId)
      .gte("created_at", `${todayISO}T00:00:00`),
  ]);

  const todayHydrationMl = (todayHydRes.data || []).reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );

  return {
    todayISO,
    hour,
    profile: profileRes.data,
    todayTargets: todayTargetsRes.data,
    todayHydrationMl,
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
- NUNCA inventés números. Si no sabés kcal/gramos exactos, estimá con prudencia y avisá que es estimación. Si el usuario te corrige, ajustá.
- Si la pregunta no tiene sentido o no tenés data, decílo honestamente.
- No dés consejo médico. Para condiciones, sugerí consultar profesional.

# TOOLS DISPONIBLES (sabés usarlas, no las menciones por nombre técnico)
- log_meal: registrá una comida cuando el usuario te lo pide explícitamente. Si tenés dudas sobre kcal o macros, PREGUNTÁ antes de registrar (NO inventés). Confirmá brevemente después con datos.
- log_water: registrá hidratación cuando el usuario te lo pide. Cantidades comunes: 250ml vaso, 500ml botella chica, 1000ml botella grande.
- get_balance: consultá el balance actual SOLO si ya registraste algo y necesitás data fresca, o si el usuario pregunta "cómo voy" después de cambios. Para preguntas iniciales, usá la data ya en contexto.

Cuando registres algo:
- Ejecutá la tool primero, después escribí 1 frase breve de confirmación con números.
- NO escribas "voy a registrar" antes — solo registralo directo.
- Si falla, decí qué pasó y ofrecé reintentar.

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

  // Derivar consumido HOY de meal_logs (no de daily_logs)
  const sumKcal = ctx.todayMeals.reduce(
    (s: number, m: any) => s + (m.total_kcal || 0),
    0,
  );
  const sumP = ctx.todayMeals.reduce(
    (s: number, m: any) => s + (m.total_protein_g || 0),
    0,
  );
  const sumC = ctx.todayMeals.reduce(
    (s: number, m: any) => s + (m.total_carbs_g || 0),
    0,
  );
  const sumF = ctx.todayMeals.reduce(
    (s: number, m: any) => s + (m.total_fat_g || 0),
    0,
  );
  const t = ctx.todayTargets || {};
  p += `\n## Balance hoy
- Consumido: ${Math.round(sumKcal)} kcal (P: ${Math.round(sumP)}g, C: ${
    Math.round(sumC)
  }g, G: ${Math.round(sumF)}g)
- Meta: ${t.kcal_target || "—"} kcal (P: ${t.protein_target_g || "—"}g, C: ${
    t.carbs_target_g || "—"
  }g, G: ${t.fat_target_g || "—"}g)
- Agua: ${ctx.todayHydrationMl}ml de ${t.water_target_ml || 2500}ml
`;

  if (ctx.todayMeals.length > 0) {
    p += `\n## Comidas registradas hoy\n`;
    ctx.todayMeals.forEach((m: any) => {
      p += `- ${m.meal_category || "?"}: ${m.items_text} (${
        Math.round(m.total_kcal || 0)
      }kcal, ${Math.round(m.total_protein_g || 0)}g P)\n`;
    });
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
