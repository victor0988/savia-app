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
const MAX_HISTORY = 8; // últimos N mensajes que enviamos al modelo (sliding window)
const SESSION_MAX_IDLE_HOURS = 4; // si pasaron más horas → archivar thread y crear nuevo
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
  {
    name: "log_workout",
    description:
      "Registra un workout/entrenamiento del usuario. Usá esto cuando el usuario dice que entrenó algo. Si no sabés kcal exactas, dejalo en null — SAVIA estima por defecto. NUNCA inventés valores específicos sin info.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "run",
            "bike",
            "swim",
            "walk",
            "strength",
            "hiit",
            "yoga",
            "other",
          ],
          description: "Tipo de actividad",
        },
        duration_min: {
          type: "number",
          description: "Duración en minutos",
        },
        intensity: {
          type: "string",
          enum: ["light", "moderate", "vigorous"],
          description: "Intensidad — si no la sabés, usá 'moderate'",
        },
        kcal_burned: {
          type: "number",
          description: "Calorías quemadas (opcional, dejá null si no sabés)",
        },
        notes: {
          type: "string",
          description: "Notas breves opcionales (ej. 'Pull day en gym')",
        },
      },
      required: ["type", "duration_min"],
    },
  },
  {
    name: "log_cycle_symptom",
    description:
      "Registra síntomas/log del ciclo del usuario para HOY. Hace upsert (merge con el log existente del día si hay uno). Usá esto cuando el usuario menciona síntomas del ciclo: cólicos, mood, energía, antojos, sangrado, sueño. NO uses esto para preguntas generales — solo cuando explícitamente reporta algo del ciclo.",
    input_schema: {
      type: "object",
      properties: {
        flow_intensity: {
          type: "string",
          enum: ["spotting", "light", "medium", "heavy"],
          description:
            "Intensidad del flujo menstrual si menciona sangrado/período",
        },
        cramp_level: {
          type: "integer",
          minimum: 0,
          maximum: 3,
          description: "0 sin · 1 leve · 2 medio · 3 fuerte",
        },
        energy_level: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Nivel de energía hoy",
        },
        mood: {
          type: "string",
          enum: ["off", "neutral", "good"],
          description: "Mood/ánimo",
        },
        cravings: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista de antojos: sweet, salty, carbs, chocolate, none",
        },
        sleep_quality_self: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Calidad de sueño autoreportada anoche (1-5)",
        },
      },
    },
  },
  {
    name: "get_cycle_phase",
    description:
      "Devuelve la fase actual del ciclo, día del ciclo, energía esperada y días hasta próximo período. Usá esto SOLO si la pregunta del usuario es realmente sobre el ciclo Y necesitás data fresca. La fase y day ya están en el contexto inicial — no llames esta tool al principio de la conversación.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_day_summary",
    description:
      "Trae el resumen completo de un día específico (NO hoy — para hoy usá los datos del contexto). Devuelve todas las comidas, workouts, hidratación, balance kcal y macros de ESE día. Usá esto cuando el usuario pregunte sobre un día puntual ('qué entrené el sábado', 'cómo me fue el lunes con macros', 'analiza mi sábado'). Date format: YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Fecha en formato YYYY-MM-DD. Si el usuario dice 'el sábado' o 'ayer', calculá la fecha exacta antes de llamar.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "get_period_summary",
    description:
      "Análisis agregado de un rango de días para alimentación + entreno + hidratación. USÁ esto cuando el usuario pida análisis cross-días (\"últimos 7 días\", \"esta semana\", \"del lunes al viernes\", \"la semana pasada\", \"el último mes\"). Devuelve totales, promedios diarios, % adherencia vs targets, y breakdown día por día con kcal y workouts. Si pide solo UN día, usá get_day_summary en su lugar.",
    input_schema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Fecha inicio YYYY-MM-DD inclusive",
        },
        end_date: {
          type: "string",
          description: "Fecha fin YYYY-MM-DD inclusive",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "delete_recent_meal",
    description:
      "Borra una comida del usuario. Pasale una descripción de lo que quiere borrar. La tool busca la comida más reciente que coincida (últimos 14 días). Si hay ambigüedad (varias coincidencias), devuelve la lista para que pidas confirmación al usuario. Usá esto cuando el usuario diga 'borrá X', 'eliminá Y', 'me equivoqué con Z'.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Descripción de la comida a borrar. Ej. 'pollo con arroz', 'yogurt griego', 'el desayuno de hoy'.",
        },
        day: {
          type: "string",
          description:
            "Fecha opcional YYYY-MM-DD para acotar la búsqueda. Si no se pasa, busca en los últimos 14 días.",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "update_health_twin",
    description:
      "Actualiza un campo del Health Twin del usuario cuando aprendés algo NUEVO sobre él/ella. Ejemplos: 'no me gusta el cilantro' → append a preferences.foods_disliked; 'mi objetivo es bajar 5kg en septiembre' → update a goals; 'me preocupa perder masa muscular' → append a context_personal.concerns; 'tomo creatina 5g al día' → append a preferences.supplements_active. USÁ esto cuando el usuario dice algo que define quién es / qué le gusta / qué le preocupa / qué le motiva / qué supplements toma / qué objetivos tiene. NO uses esto para eventos del día (eso es log_meal/log_water). NO uses para cosas que ya sabés del contexto.",
    input_schema: {
      type: "object",
      properties: {
        field_path: {
          type: "string",
          description:
            "Dot-path al campo. Debe arrancar con uno de: identity, goals, lifestyle, preferences, biomarkers, nutrition, integrations, womens_health, context_personal. Ejemplos: 'preferences.foods_disliked', 'identity.weight_kg_current', 'context_personal.concerns', 'lifestyle.training_days'. Para reemplazar un goal entero usar 'goals'.",
        },
        operation: {
          type: "string",
          enum: ["set", "append"],
          description:
            "'set' reemplaza el valor en ese path. 'append' agrega al array (asume que el path apunta a un array — falla si no).",
        },
        value: {
          description:
            "El valor nuevo. Tipo libre: string, número, array, object. Para append, es el item a agregar. Para set, es el valor completo.",
        },
        reason: {
          type: "string",
          description:
            "Una frase BREVE en español explicando qué dijo el usuario que te llevó a actualizar esto. Ej: 'Usuario dijo: no me gusta el cilantro'.",
        },
      },
      required: ["field_path", "operation", "value", "reason"],
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

    // Resolve thread (get default o create new) — auto-sesión por inactividad
    let threadId: string | null = body.thread_id || null;

    // Si el cliente mandó un thread_id, verificar que siga activo (no archivado
    // por idle). Si está archivado, ignorarlo y caer al flow de default.
    if (threadId) {
      const { data: existingThread } = await supabaseAdmin
        .from("coach_threads")
        .select("archived, last_message_at, created_at")
        .eq("id", threadId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!existingThread || existingThread.archived) {
        threadId = null;
      } else {
        // Aún si no está archivado en DB, chequear idle
        const lastTs = existingThread.last_message_at || existingThread.created_at;
        if (lastTs) {
          const idleHours = (Date.now() - new Date(lastTs).getTime()) / 3600000;
          if (idleHours >= SESSION_MAX_IDLE_HOURS) {
            console.log(`[ai-chat] auto-archive client-provided thread (idle ${idleHours.toFixed(1)}h)`);
            await supabaseAdmin
              .from("coach_threads")
              .update({ archived: true })
              .eq("id", threadId);
            threadId = null;
          }
        }
      }
    }

    if (!threadId) {
      // Buscar default thread activo del user — order().limit(1) tolera
      // duplicados si algún día se cuelan (en lugar de .maybeSingle() que
      // tira error si hay >1 row).
      const { data: existingRows } = await supabaseAdmin
        .from("coach_threads")
        .select("id, last_message_at, created_at")
        .eq("user_id", user.id)
        .eq("is_default", true)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1);
      const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

      // Capa 2: auto-archivar si pasaron más de SESSION_MAX_IDLE_HOURS sin actividad.
      // Usar conditional update (archived=false) para evitar race con otra request
      // concurrente que también esté archivando el mismo thread.
      let shouldCreateNew = !existing;
      if (existing) {
        const lastTs = existing.last_message_at || existing.created_at;
        if (lastTs) {
          const idleMs = Date.now() - new Date(lastTs).getTime();
          const idleHours = idleMs / 3600000;
          if (idleHours >= SESSION_MAX_IDLE_HOURS) {
            console.log(`[ai-chat] auto-archive thread (idle ${idleHours.toFixed(1)}h)`);
            const { data: archivedRows } = await supabaseAdmin
              .from("coach_threads")
              .update({ archived: true })
              .eq("id", existing.id)
              .eq("archived", false)
              .select("id");
            // Solo crear nuevo si ganamos la race (la update returnó row).
            // Si no ganamos, otro request ya archivó y creó uno nuevo — reusamos.
            if (archivedRows && archivedRows.length > 0) {
              shouldCreateNew = true;
            } else {
              // Re-query: buscar el default activo que el otro request creó.
              const { data: refreshed } = await supabaseAdmin
                .from("coach_threads")
                .select("id")
                .eq("user_id", user.id)
                .eq("is_default", true)
                .eq("archived", false)
                .order("created_at", { ascending: false })
                .limit(1);
              if (refreshed && refreshed.length > 0) {
                threadId = refreshed[0].id;
              } else {
                shouldCreateNew = true;
              }
            }
          } else {
            threadId = existing.id;
          }
        } else {
          threadId = existing.id;
        }
      }

      if (shouldCreateNew) {
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

    // Reconstruir history válido para Anthropic API.
    // Anthropic requiere ALTERNANCIA estricta user/assistant/user/assistant…
    // Si hay tool messages en el historial (de llamadas previas), los filtramos
    // pero también colapsamos consecutivos del mismo role (que quedarían al
    // excluir tool messages) para no romper alternancia.
    const rawMessages = (historyRows || [])
      .filter((m) =>
        m.content && (m.role === "user" || m.role === "assistant")
      );
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of rawMessages) {
      const lastRole = messages.length ? messages[messages.length - 1].role : null;
      if (lastRole === m.role) {
        // Consecutivo del mismo role: reemplazar con el más nuevo (más relevante)
        messages[messages.length - 1] = {
          role: m.role as "user" | "assistant",
          content: m.content as string,
        };
      } else {
        messages.push({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        });
      }
    }
    // Anthropic requiere que el primer mensaje sea 'user'
    while (messages.length && messages[0].role !== "user") {
      messages.shift();
    }
    // Y el último también (el msg actual del user)
    if (messages.length && messages[messages.length - 1].role !== "user") {
      messages.pop();
    }
    console.log("[ai-chat] sanitized messages count:", messages.length);

    // Build user context (parallel queries)
    // Tz info viene del cliente para evitar bugs de "hoy" en UTC vs hora local
    const todayStartISO: string | undefined = body.today_start_iso;
    const tzOffsetMin: number | undefined = body.tz_offset_min;
    const pulseContext: string | null = body.pulse_context || null;
    const ctx = await buildUserContext(supabaseAdmin, user.id, todayStartISO, tzOffsetMin);
    let systemPrompt = buildSystemPrompt(ctx);

    // Si el user entró al chat desde un Pulse, inyectar el context_for_chat
    // al inicio del system prompt para que el coach profundice en ese insight
    // específico durante el primer mensaje.
    if (pulseContext && typeof pulseContext === "string" && pulseContext.length > 0) {
      systemPrompt = `# CONTEXTO INMEDIATO — el usuario abrió el chat desde un Pulse específico
${pulseContext}

El primer mensaje del usuario va a estar relacionado a este pulse. Profundizá en eso con conexiones específicas a sus datos. Después seguí la conversación normal.

---

${systemPrompt}`;
    }

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
            console.log(`[ai-chat] iteration ${iterations} start. messages count:`, apiMessages.length);

            let textBuffer = "";
            const anthropicStream = await anthropic.messages.stream({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system: systemPrompt,
              tools: TOOLS as any,
              messages: apiMessages,
            });

            const eventTypes: string[] = [];
            for await (const event of anthropicStream) {
              eventTypes.push(event.type);
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
            console.log(`[ai-chat] iteration ${iterations} events:`, eventTypes.join(","));

            const finalMessage = await anthropicStream.finalMessage();
            console.log(`[ai-chat] iteration ${iterations} stop_reason:`, finalMessage.stop_reason);
            console.log(`[ai-chat] iteration ${iterations} content blocks:`, JSON.stringify(finalMessage.content.map((b: any) => ({ type: b.type, name: b.name, text: b.text?.slice(0, 60) }))));
            console.log(`[ai-chat] iteration ${iterations} textBuffer length:`, textBuffer.length);

            // FALLBACK: si el for-await NO capturó deltas pero finalMessage tiene
            // texto, emitirlos manualmente (defensivo contra SDK que no emite
            // text_delta events en Deno).
            if (textBuffer.length === 0) {
              const textBlocks = finalMessage.content.filter((b: any) => b.type === "text");
              for (const block of textBlocks) {
                const txt = (block as any).text || "";
                if (txt) {
                  textBuffer += txt;
                  send("delta", { text: txt });
                }
              }
              if (textBuffer.length > 0) {
                console.log(`[ai-chat] iteration ${iterations} fallback: emitted ${textBuffer.length} chars from finalMessage`);
              }
            }

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
                ctx.todayStartISO,
                ctx.todayISO,
                tzOffsetMin,
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
  todayStartISO?: string,
  todayISO?: string,
  tzOffsetMin?: number,
): Promise<any> {
  try {
    if (name === "log_meal") return await executeLogMeal(input, userId, supabase);
    if (name === "log_water") return await executeLogWater(input, userId, supabase);
    if (name === "get_balance") return await executeGetBalance(userId, supabase, todayStartISO, todayISO);
    if (name === "log_workout") return await executeLogWorkout(input, userId, supabase);
    if (name === "log_cycle_symptom") return await executeLogCycleSymptom(input, userId, supabase);
    if (name === "get_cycle_phase") return await executeGetCyclePhase(userId, supabase);
    if (name === "update_health_twin") return await executeUpdateHealthTwin(input, userId, supabase);
    if (name === "get_day_summary") return await executeGetDaySummary(input, userId, supabase, tzOffsetMin);
    if (name === "get_period_summary") return await executeGetPeriodSummary(input, userId, supabase, tzOffsetMin);
    if (name === "delete_recent_meal") return await executeDeleteRecentMeal(input, userId, supabase, tzOffsetMin);
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

  // Análisis post-write: balance actualizado del día + warnings si
  // compromete los macros restantes
  const balance = await executeGetBalance(userId, supabase);
  const warnings: string[] = [];
  if (balance && !balance.error) {
    if (
      balance.kcal_target &&
      balance.kcal_remaining != null &&
      balance.kcal_remaining < 200
    ) {
      warnings.push(
        `Solo te quedan ${balance.kcal_remaining} kcal para el resto del día.`,
      );
    }
    if (
      balance.kcal_target &&
      balance.kcal_consumed > balance.kcal_target * 1.05
    ) {
      warnings.push(
        `Excediste el target en ${
          balance.kcal_consumed - balance.kcal_target
        } kcal.`,
      );
    }
    // Nota: warnings de proteína intencionalmente NO se incluyen aquí porque
    // generan false positives en el desayuno. El LLM puede razonar sobre
    // proteína viendo balance_after directamente con awareness de hora del día.
  }

  return {
    ok: true,
    id: data.id,
    summary: `${input.name} · ${Math.round(kcal)} kcal${
      input.protein_g ? ` · ${input.protein_g}g P` : ""
    }`,
    balance_after: balance && !balance.error ? balance : null,
    warnings,
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
  todayStartISO?: string,
  todayISO?: string,
): Promise<any> {
  // Si no nos pasaron los ISOs del cliente, fallback a UTC
  if (!todayStartISO || !todayISO) {
    const t = new Date();
    todayISO = t.toISOString().split("T")[0];
    todayStartISO = `${todayISO}T00:00:00.000Z`;
  }
  const [mealsRes, hydRes, dailyRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("total_kcal, total_protein_g, total_carbs_g, total_fat_g")
      .eq("user_id", userId)
      .gte("ts", todayStartISO),
    supabase
      .from("hydration_logs")
      .select("ml")
      .eq("user_id", userId)
      .gte("ts", todayStartISO),
    supabase
      .from("daily_logs")
      .select(
        "kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml",
      )
      .eq("user_id", userId)
      .eq("log_date", todayISO)
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

// ─── log_workout ─────────────────────────────────────────────────────
const VALID_WK_TYPES = [
  "run",
  "bike",
  "swim",
  "walk",
  "strength",
  "hiit",
  "yoga",
  "other",
];
const VALID_WK_INTENSITY = ["light", "moderate", "vigorous"];

async function executeLogWorkout(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  if (!input?.type || !VALID_WK_TYPES.includes(input.type)) {
    return { error: `Invalid type. Use one of: ${VALID_WK_TYPES.join(", ")}` };
  }
  const duration = Number(input.duration_min);
  if (isNaN(duration) || duration <= 0 || duration > 600) {
    return { error: "duration_min must be 1-600 minutes" };
  }
  const intensity = input.intensity || "moderate";
  if (!VALID_WK_INTENSITY.includes(intensity)) {
    return {
      error: `Invalid intensity. Use one of: ${VALID_WK_INTENSITY.join(", ")}`,
    };
  }
  const payload: any = {
    user_id: userId,
    type: input.type,
    duration_min: Math.round(duration),
    intensity,
    source: "coach",
  };
  if (input.kcal_burned != null) {
    const k = Number(input.kcal_burned);
    if (!isNaN(k) && k >= 0 && k <= 3000) {
      payload.kcal_burned = Math.round(k);
    }
  }
  if (input.notes) {
    payload.notes = String(input.notes).slice(0, 300);
  }
  const { data, error } = await supabase
    .from("workout_logs")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("[log_workout] insert error:", error);
    return { error: error.message };
  }
  return {
    ok: true,
    id: data.id,
    summary: `${input.type} · ${Math.round(duration)}min · ${intensity}${
      payload.kcal_burned ? ` · ${payload.kcal_burned} kcal` : ""
    }`,
  };
}

// ─── log_cycle_symptom (upsert merge) ────────────────────────────────
async function executeLogCycleSymptom(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  // Verificar Women's Health activado
  const { data: whProfile } = await supabase
    .from("women_health_profile")
    .select("enabled, status, avg_cycle_length_days, avg_period_length_days, last_period_start_date")
    .eq("user_id", userId)
    .maybeSingle();
  if (!whProfile?.enabled) {
    return {
      error:
        "Women's Health no está activado. El usuario debe activarlo en Perfil primero.",
    };
  }

  const today = new Date().toISOString().split("T")[0];

  // Load existing row para merge
  const { data: existing } = await supabase
    .from("cycle_day_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("log_date", today)
    .maybeSingle();

  // Calcular cycle_day y phase si aplica
  let cycle_day = null;
  let predicted_phase = null;
  if (
    ["cycle_natural", "hormonal_bc"].includes(whProfile.status) &&
    whProfile.last_period_start_date
  ) {
    const cycleLen = whProfile.avg_cycle_length_days || 28;
    const periodLen = whProfile.avg_period_length_days || 5;
    const last = new Date(whProfile.last_period_start_date + "T00:00:00");
    const todayDate = new Date(today + "T00:00:00");
    const diffDays = Math.floor(
      (todayDate.getTime() - last.getTime()) / 86400000,
    );
    if (diffDays >= 0) {
      cycle_day = (diffDays % cycleLen) + 1;
      // Phase calc
      if (cycle_day <= periodLen) predicted_phase = "menstrual";
      else {
        const ovulationDay = cycleLen - 14;
        if (cycle_day < ovulationDay - 2) predicted_phase = "follicular";
        else if (cycle_day <= ovulationDay + 2) predicted_phase = "ovulatory";
        else {
          const lutealMid = Math.floor((ovulationDay + 3 + cycleLen) / 2);
          predicted_phase = cycle_day <= lutealMid ? "luteal_early" : "luteal_late";
        }
      }
    }
  }

  // Build payload: solo campos que vienen en input (merge con existente)
  const payload: any = {
    user_id: userId,
    log_date: today,
    cycle_day,
    predicted_phase,
  };

  if (input.flow_intensity !== undefined) payload.flow_intensity = input.flow_intensity;
  if (input.cramp_level !== undefined) payload.cramp_level = Math.max(0, Math.min(3, Math.round(Number(input.cramp_level))));
  if (input.energy_level !== undefined) payload.energy_level = input.energy_level;
  if (input.mood !== undefined) payload.mood = input.mood;
  if (input.cravings !== undefined && Array.isArray(input.cravings)) payload.cravings = input.cravings;
  if (input.sleep_quality_self !== undefined) payload.sleep_quality_self = Math.max(1, Math.min(5, Math.round(Number(input.sleep_quality_self))));

  // Preserve existing fields not provided in this update
  if (existing) {
    if (payload.flow_intensity === undefined && existing.flow_intensity !== null) payload.flow_intensity = existing.flow_intensity;
    if (payload.cramp_level === undefined && existing.cramp_level !== null) payload.cramp_level = existing.cramp_level;
    if (payload.energy_level === undefined && existing.energy_level !== null) payload.energy_level = existing.energy_level;
    if (payload.mood === undefined && existing.mood !== null) payload.mood = existing.mood;
    if (payload.cravings === undefined && Array.isArray(existing.cravings) && existing.cravings.length) payload.cravings = existing.cravings;
    if (payload.sleep_quality_self === undefined && existing.sleep_quality_self !== null) payload.sleep_quality_self = existing.sleep_quality_self;
  }

  const { data, error } = await supabase
    .from("cycle_day_logs")
    .upsert(payload, { onConflict: "user_id,log_date" })
    .select("id")
    .single();
  if (error) {
    console.error("[log_cycle_symptom] upsert error:", error);
    return { error: error.message };
  }

  // Summary humano
  const parts: string[] = [];
  if (input.flow_intensity) parts.push(`flujo ${input.flow_intensity}`);
  if (input.cramp_level !== undefined) parts.push(`cólicos ${input.cramp_level}/3`);
  if (input.energy_level) parts.push(`energía ${input.energy_level}`);
  if (input.mood) parts.push(`mood ${input.mood}`);
  if (Array.isArray(input.cravings) && input.cravings.length) parts.push(`antojos: ${input.cravings.join(", ")}`);
  if (input.sleep_quality_self) parts.push(`sueño ${input.sleep_quality_self}/5`);

  return {
    ok: true,
    id: data.id,
    summary: parts.length ? parts.join(" · ") : "log actualizado",
  };
}

// ─── get_cycle_phase ─────────────────────────────────────────────────
async function executeGetCyclePhase(
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  const { data: whProfile } = await supabase
    .from("women_health_profile")
    .select("enabled, status, avg_cycle_length_days, avg_period_length_days, last_period_start_date")
    .eq("user_id", userId)
    .maybeSingle();
  if (!whProfile?.enabled) {
    return { error: "Women's Health no está activado." };
  }
  if (!["cycle_natural", "hormonal_bc"].includes(whProfile.status)) {
    return {
      status: whProfile.status,
      message: `Usuario está en modo ${whProfile.status}, no aplica fase de ciclo regular.`,
    };
  }
  if (!whProfile.last_period_start_date) {
    return { error: "Sin fecha de último período registrada. Pedí al usuario que la registre." };
  }

  const cycleLen = whProfile.avg_cycle_length_days || 28;
  const periodLen = whProfile.avg_period_length_days || 5;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last = new Date(whProfile.last_period_start_date + "T00:00:00");
  const diffDays = Math.floor(
    (today.getTime() - last.getTime()) / 86400000,
  );
  if (diffDays < 0) {
    return { error: "Última fecha de período es futura, inválida." };
  }
  const cycle_day = (diffDays % cycleLen) + 1;

  // Phase
  let phase = "follicular";
  if (cycle_day <= periodLen) phase = "menstrual";
  else {
    const ovulationDay = cycleLen - 14;
    if (cycle_day < ovulationDay - 2) phase = "follicular";
    else if (cycle_day <= ovulationDay + 2) phase = "ovulatory";
    else {
      const lutealMid = Math.floor((ovulationDay + 3 + cycleLen) / 2);
      phase = cycle_day <= lutealMid ? "luteal_early" : "luteal_late";
    }
  }

  // Energy estimate
  const energyByPhase: Record<string, { score: number; label: string }> = {
    menstrual: { score: 45, label: "baja" },
    follicular: { score: 78, label: "alta" },
    ovulatory: { score: 88, label: "pico" },
    luteal_early: { score: 72, label: "buena" },
    luteal_late: { score: 52, label: "bajando" },
  };
  const energy = energyByPhase[phase] || { score: 60, label: "media" };
  const days_until_next_period = Math.max(0, cycleLen - cycle_day);

  return {
    ok: true,
    cycle_day,
    cycle_length: cycleLen,
    phase,
    energy_score: energy.score,
    energy_label: energy.label,
    days_until_next_period,
  };
}

// ─── get_day_summary: análisis de un día específico ──────────────────

async function executeGetDaySummary(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
  tzOffsetMin?: number,
): Promise<any> {
  const date = String(input?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date debe ser YYYY-MM-DD" };
  }

  // Construir rango del día respetando timezone del cliente.
  // tzOffsetMin viene de JS getTimezoneOffset() — positivo si está al
  // oeste de UTC (ej. Costa Rica = +360 min). Para convertir medianoche
  // LOCAL del cliente a UTC: sumamos el offset.
  // Ej: 2026-06-07 00:00 CR = 2026-06-07 06:00 UTC, así "el sábado" CR
  // va de Sat 06:00 UTC a Sun 06:00 UTC.
  const offsetMs = (tzOffsetMin ?? 0) * 60 * 1000;
  const startUTC = new Date(`${date}T00:00:00.000Z`).getTime() + offsetMs;
  const endUTC = startUTC + 86400000;
  const startISO = new Date(startUTC).toISOString();
  const endISO = new Date(endUTC).toISOString();

  const [mealsRes, workoutsRes, hydRes, dailyRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("id, items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, meal_category, ts")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO)
      .order("ts", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("id, type, duration_min, intensity, kcal_burned, source, ts")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO)
      .order("ts", { ascending: true }),
    supabase
      .from("hydration_logs")
      .select("ml")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO),
    supabase
      .from("daily_logs")
      .select(
        "kcal_target, protein_target_g, carbs_target_g, fat_target_g, water_target_ml",
      )
      .eq("user_id", userId)
      .eq("log_date", date)
      .maybeSingle(),
  ]);

  const meals = mealsRes.data || [];
  const workouts = workoutsRes.data || [];
  const hydMl = (hydRes.data || []).reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );

  const kcal = meals.reduce((s: number, m: any) => s + (m.total_kcal || 0), 0);
  const prot = meals.reduce((s: number, m: any) => s + (m.total_protein_g || 0), 0);
  const carbs = meals.reduce((s: number, m: any) => s + (m.total_carbs_g || 0), 0);
  const fat = meals.reduce((s: number, m: any) => s + (m.total_fat_g || 0), 0);
  const kcalBurned = workouts.reduce(
    (s: number, w: any) => s + (w.kcal_burned || 0),
    0,
  );

  const t = dailyRes.data || {};

  return {
    ok: true,
    date,
    summary: {
      total_kcal: Math.round(kcal),
      total_protein_g: Math.round(prot),
      total_carbs_g: Math.round(carbs),
      total_fat_g: Math.round(fat),
      total_hydration_ml: hydMl,
      total_kcal_burned: Math.round(kcalBurned),
      meals_count: meals.length,
      workouts_count: workouts.length,
    },
    targets: {
      kcal: t.kcal_target ?? null,
      protein_g: t.protein_target_g ?? null,
      carbs_g: t.carbs_target_g ?? null,
      fat_g: t.fat_target_g ?? null,
      water_ml: t.water_target_ml ?? null,
    },
    meals: meals.map((m: any) => ({
      meal_category: m.meal_category,
      items_text: m.items_text,
      kcal: Math.round(m.total_kcal || 0),
      protein_g: Math.round(m.total_protein_g || 0),
    })),
    workouts: workouts.map((w: any) => ({
      type: w.type,
      duration_min: w.duration_min,
      intensity: w.intensity,
      kcal_burned: w.kcal_burned,
      source: w.source,
    })),
  };
}

// ─── get_period_summary: análisis agregado de un rango de días ───────

async function executeGetPeriodSummary(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
  tzOffsetMin?: number,
): Promise<any> {
  const start_date = String(input?.start_date || "").trim();
  const end_date = String(input?.end_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return { error: "start_date y end_date deben ser YYYY-MM-DD" };
  }
  if (start_date > end_date) {
    return { error: "start_date debe ser <= end_date" };
  }

  // Convertir cada fecha a medianoche LOCAL del cliente expresada como UTC
  const offsetMs = (tzOffsetMin ?? 0) * 60 * 1000;
  const startUTC = new Date(`${start_date}T00:00:00.000Z`).getTime() + offsetMs;
  const endUTC = new Date(`${end_date}T00:00:00.000Z`).getTime() + offsetMs + 86400000;
  if (endUTC - startUTC > 92 * 86400000) {
    return { error: "Rango máximo 92 días" };
  }
  const startISO = new Date(startUTC).toISOString();
  const endISO = new Date(endUTC).toISOString();
  const daysInRange = Math.round((endUTC - startUTC) / 86400000);

  // Queries en paralelo
  const [mealsRes, workoutsRes, hydRes, targetsRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("total_kcal, total_protein_g, total_carbs_g, total_fat_g, meal_category, items_text, ts")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO)
      .order("ts", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("type, duration_min, intensity, kcal_burned, source, ts")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO)
      .order("ts", { ascending: true }),
    supabase
      .from("hydration_logs")
      .select("ml, ts")
      .eq("user_id", userId)
      .gte("ts", startISO)
      .lt("ts", endISO),
    // Tomar targets del HT (más actual) si existen
    supabase
      .from("user_health_twin")
      .select("nutrition")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const meals = mealsRes.data || [];
  const workouts = workoutsRes.data || [];
  const hydrations = hydRes.data || [];

  // ─── Agregados totales ───
  const totals = meals.reduce(
    (acc: any, m: any) => {
      acc.kcal += m.total_kcal || 0;
      acc.protein_g += m.total_protein_g || 0;
      acc.carbs_g += m.total_carbs_g || 0;
      acc.fat_g += m.total_fat_g || 0;
      return acc;
    },
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const total_hydration_ml = hydrations.reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );
  const total_kcal_burned = workouts.reduce(
    (s: number, w: any) => s + (w.kcal_burned || 0),
    0,
  );

  // ─── Aggregate by day (para per-day breakdown + days con datos) ───
  type DayAgg = { kcal: number; protein: number; meals: number; workouts: number; hydration_ml: number };
  const byDay = new Map<string, DayAgg>();
  // Helper: convertir un ts (UTC) a fecha LOCAL del cliente YYYY-MM-DD
  const tsToLocalDate = (ts: string): string => {
    const localMs = new Date(ts).getTime() - offsetMs;
    return new Date(localMs).toISOString().split("T")[0];
  };
  for (const m of meals) {
    const day = tsToLocalDate(m.ts);
    const e = byDay.get(day) || { kcal: 0, protein: 0, meals: 0, workouts: 0, hydration_ml: 0 };
    e.kcal += m.total_kcal || 0;
    e.protein += m.total_protein_g || 0;
    e.meals++;
    byDay.set(day, e);
  }
  for (const w of workouts) {
    const day = tsToLocalDate(w.ts);
    const e = byDay.get(day) || { kcal: 0, protein: 0, meals: 0, workouts: 0, hydration_ml: 0 };
    e.workouts++;
    byDay.set(day, e);
  }
  for (const h of hydrations) {
    const day = tsToLocalDate(h.ts);
    const e = byDay.get(day) || { kcal: 0, protein: 0, meals: 0, workouts: 0, hydration_ml: 0 };
    e.hydration_ml += h.ml || 0;
    byDay.set(day, e);
  }

  const days_with_data = byDay.size;
  // Días específicamente con COMIDAS registradas (para promedios kcal/protein
  // que no se vean diluidos por workout-only days)
  const days_with_meals = Array.from(byDay.values()).filter((d) => d.meals > 0).length;
  const kcal_avg_per_active_day = days_with_meals > 0 ? Math.round(totals.kcal / days_with_meals) : 0;
  const protein_avg_per_active_day = days_with_meals > 0 ? Math.round(totals.protein_g / days_with_meals) : 0;

  // ─── Targets para % adherencia ───
  const htNutrition = targetsRes.data?.nutrition || {};
  const kcal_target = htNutrition.kcal_target ?? null;
  const protein_target_g = htNutrition.protein_target_g ?? null;
  // Si hay target pero 0 días con meals, adherencia es 0% (más honesto que null)
  const kcal_adherence_pct = kcal_target != null
    ? Math.round((kcal_avg_per_active_day / kcal_target) * 100)
    : null;
  const protein_adherence_pct = protein_target_g != null
    ? Math.round((protein_avg_per_active_day / protein_target_g) * 100)
    : null;

  // ─── Workout breakdown ───
  const typeCounts = new Map<string, number>();
  for (const w of workouts) {
    if (!w.type) continue;
    typeCounts.set(w.type, (typeCounts.get(w.type) || 0) + 1);
  }
  const workoutTypeBreakdown = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  // ─── Per-day breakdown (ordenado por fecha) ───
  const per_day = Array.from(byDay.entries())
    .map(([date, d]) => ({
      date,
      kcal: Math.round(d.kcal),
      protein_g: Math.round(d.protein),
      meals_count: d.meals,
      workouts_count: d.workouts,
      hydration_ml: d.hydration_ml,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ok: true,
    period: { start_date, end_date, days_in_range: daysInRange, days_with_data, days_with_meals },
    totals: {
      kcal: Math.round(totals.kcal),
      protein_g: Math.round(totals.protein_g),
      carbs_g: Math.round(totals.carbs_g),
      fat_g: Math.round(totals.fat_g),
      hydration_ml: total_hydration_ml,
      kcal_burned_workouts: Math.round(total_kcal_burned),
      meals: meals.length,
      workouts: workouts.length,
    },
    averages_per_active_day: {
      kcal: kcal_avg_per_active_day,
      protein_g: protein_avg_per_active_day,
    },
    targets_daily: {
      kcal: kcal_target,
      protein_g: protein_target_g,
    },
    adherence: {
      kcal_pct: kcal_adherence_pct,
      protein_pct: protein_adherence_pct,
    },
    workouts_by_type: workoutTypeBreakdown,
    per_day,
  };
}

// ─── delete_recent_meal: borrar comida por descripción ───────────────

async function executeDeleteRecentMeal(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
  tzOffsetMin?: number,
): Promise<any> {
  const description = String(input?.description || "").trim();
  if (!description) return { error: "description requerido" };
  const day = input?.day ? String(input.day).trim() : null;

  // Rango de búsqueda — con tz del cliente si se especifica un día puntual
  let startISO: string;
  let endISO: string;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const offsetMs = (tzOffsetMin ?? 0) * 60 * 1000;
    const startUTC = new Date(`${day}T00:00:00.000Z`).getTime() + offsetMs;
    startISO = new Date(startUTC).toISOString();
    endISO = new Date(startUTC + 86400000).toISOString();
  } else {
    const fourteenAgo = new Date(Date.now() - 14 * 86400000);
    startISO = fourteenAgo.toISOString();
    endISO = new Date(Date.now() + 86400000).toISOString();
  }

  const { data: candidates, error: queryErr } = await supabase
    .from("meal_logs")
    .select("id, items_text, meal_category, total_kcal, ts")
    .eq("user_id", userId)
    .gte("ts", startISO)
    .lt("ts", endISO)
    .order("ts", { ascending: false })
    .limit(50);
  if (queryErr) return { error: queryErr.message };
  if (!candidates || candidates.length === 0) {
    return { error: "No encontré comidas registradas en ese rango." };
  }

  const needle = normalizeKey(description);
  const tokens = needle.split(" ").filter((t) => t.length >= 3);

  // Scoring: cuántos tokens del needle aparecen en items_text normalizado
  const scored = candidates.map((c: any) => {
    const hay = normalizeKey(c.items_text || "");
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
    }
    // Bonus si el needle completo está en el haystack
    if (needle && hay.includes(needle)) score += 5;
    return { row: c, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return {
      error:
        `No encontré ninguna comida que coincida con "${description}". Las últimas registradas: ${
          candidates.slice(0, 3).map((c: any) => `"${c.items_text}"`).join(", ")
        }`,
    };
  }

  // Operación destructiva: si hay empate del top score (no importa el valor),
  // pedir confirmación al usuario. Mejor preguntar que borrar lo equivocado.
  if (
    matches.length >= 2 &&
    matches[0].score === matches[1].score
  ) {
    return {
      needs_confirmation: true,
      message:
        `Hay ${matches.length} comidas que coinciden con "${description}". Pediselo al usuario para que confirme:`,
      candidates: matches.slice(0, 5).map((m: any) => ({
        id: m.row.id,
        items_text: m.row.items_text,
        meal_category: m.row.meal_category,
        kcal: m.row.total_kcal,
        ts: m.row.ts,
      })),
    };
  }

  // Borrar la mejor match
  const best = matches[0].row;
  const { error: delErr } = await supabase
    .from("meal_logs")
    .delete()
    .eq("id", best.id)
    .eq("user_id", userId);
  if (delErr) return { error: `delete failed: ${delErr.message}` };

  return {
    ok: true,
    deleted: {
      items_text: best.items_text,
      meal_category: best.meal_category,
      kcal: best.total_kcal,
      ts: best.ts,
    },
    summary: `Borrada: ${best.items_text} (${best.total_kcal} kcal)`,
  };
}

// ─── Health Twin: helpers + executor + bootstrap + compactador ───────

const HT_BUCKETS = [
  "identity",
  "goals",
  "lifestyle",
  "preferences",
  "biomarkers",
  "nutrition",
  "integrations",
  "womens_health",
  "context_personal",
];

function getValueAtPath(obj: any, segments: string[]): any {
  let cur = obj;
  for (const s of segments) {
    if (cur == null) return null;
    cur = cur[s];
  }
  return cur ?? null;
}

function setNested(obj: any, segments: string[], value: any): any {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  const isArrayIndex = /^\d+$/.test(head);
  const base = obj == null ? (isArrayIndex ? [] : {}) : (Array.isArray(obj) ? [...obj] : { ...obj });
  if (isArrayIndex) {
    const idx = parseInt(head);
    base[idx] = setNested(base[idx], rest, value);
  } else {
    base[head] = setNested(base[head], rest, value);
  }
  return base;
}

async function executeUpdateHealthTwin(
  input: any,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  const field_path = String(input?.field_path || "");
  const operation = String(input?.operation || "");
  const value = input?.value;
  const reason = String(input?.reason || "").slice(0, 500);

  const segments = field_path.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { error: "field_path required" };
  const bucket = segments[0];
  if (!HT_BUCKETS.includes(bucket)) {
    return { error: `field_path debe empezar con: ${HT_BUCKETS.join(", ")}` };
  }
  if (!["set", "append"].includes(operation)) {
    return { error: "operation debe ser 'set' o 'append'" };
  }
  if (value === undefined) return { error: "value es requerido" };

  // Asegurar que existe el HT row con defaults VÁLIDOS (CHECK constraints
  // requieren cada bucket NOT NULL + jsonb_typeof correcto). Si no existe,
  // upsert con buckets vacíos válidos. Si ya existe, ignoreDuplicates evita
  // sobreescribir.
  await supabase
    .from("user_health_twin")
    .upsert(
      {
        user_id: userId,
        identity: {},
        goals: [],
        lifestyle: {},
        preferences: {},
        biomarkers: {},
        nutrition: {},
        integrations: {},
        womens_health: {},
        context_personal: {},
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  // Leer estado actual
  const { data: currentHT, error: readErr } = await supabase
    .from("user_health_twin")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr || !currentHT) {
    return { error: `HT read failed: ${readErr?.message || "not found"}` };
  }

  const old_value = getValueAtPath(currentHT, segments);
  let new_value: any;
  if (operation === "set") {
    new_value = value;
  } else {
    // append
    const existing = Array.isArray(old_value) ? old_value : [];
    new_value = [...existing, value];
  }

  // Construir el bucket actualizado
  const bucketRest = segments.slice(1);
  const goalsDefault = bucket === "goals" ? [] : {};
  const currentBucketValue = currentHT[bucket] ?? goalsDefault;
  const updatedBucket = setNested(currentBucketValue, bucketRest, new_value);

  // Update + audit log (no transaccional pero acepta riesgo MVP)
  const { error: updErr } = await supabase
    .from("user_health_twin")
    .update({
      [bucket]: updatedBucket,
      last_significant_update: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (updErr) return { error: `update failed: ${updErr.message}` };

  // Audit log (service_role bypassa RLS WITH CHECK false)
  await supabase.from("health_twin_updates").insert({
    user_id: userId,
    field_path,
    old_value: old_value ?? null,
    new_value: new_value ?? null,
    source: "coach",
    reason: reason || null,
  });

  return {
    ok: true,
    field_path,
    operation,
    summary: `${field_path} actualizado (${operation})`,
  };
}

/**
 * Bootstrap: si el HT no existe, crear uno con data de las tablas existentes.
 * No-op si el HT ya existe.
 */
async function bootstrapHealthTwin(
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<any> {
  // Verificar si ya existe
  const { data: existing } = await supabase
    .from("user_health_twin")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return null; // ya existe, no bootstrap

  // Leer fuentes en paralelo
  const [profileRes, inBodyRes, planRes, whRes, stravaRes] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("name, sex, age, level, height_cm, weight_kg, goals")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("inbody_records")
      .select("*")
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meal_plans")
      .select("*")
      .eq("patient_user_id", userId)
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("women_health_profile")
      .select(
        "enabled, status, avg_cycle_length_days, avg_period_length_days, last_period_start_date, goals, conditions",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("strava_athletes")
      .select("athlete_id, connected_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const profile = profileRes.data || {};
  const inbody = inBodyRes.data || null;
  const plan = planRes.data || null;
  const wh = whRes.data || null;
  const strava = stravaRes.data || null;

  // Componer buckets
  const identity: any = {};
  if (profile.name) identity.name = profile.name;
  if (profile.sex) identity.sex = profile.sex;
  if (profile.age) identity.age = profile.age;
  if (profile.height_cm) identity.height_cm = profile.height_cm;
  if (profile.weight_kg) identity.weight_kg_current = profile.weight_kg;
  if (profile.level) identity.level = profile.level;
  if (inbody) {
    if (inbody.weight_kg) identity.weight_kg_current = inbody.weight_kg;
    if (inbody.body_fat_pct) identity.body_fat_pct = inbody.body_fat_pct;
    if (inbody.muscle_mass_kg) identity.lean_mass_kg = inbody.muscle_mass_kg;
    if (inbody.visceral_fat_level) identity.visceral_fat_level = inbody.visceral_fat_level;
    if (inbody.basal_metabolic_rate) identity.bmr_kcal = inbody.basal_metabolic_rate;
  }

  // Goals: conviértelos de strings simples a objetos (filtrando vacíos)
  const goals: any[] = [];
  if (Array.isArray(profile.goals)) {
    profile.goals
      .filter((g: string) => g && typeof g === "string" && g.trim().length > 0)
      .forEach((g: string, i: number) => {
        goals.push({
          name: g,
          priority: i === 0 ? "primary" : "secondary",
          status: "active",
          since: new Date().toISOString().split("T")[0],
        });
      });
  }

  const lifestyle: any = { country: "Costa Rica" };

  const preferences: any = {};

  const biomarkers: any = {};
  if (inbody?.id) biomarkers.last_inbody_id = inbody.id;

  const nutrition: any = {};
  if (plan) {
    nutrition.active_plan_id = plan.id;
    nutrition.plan_name = plan.name || plan.title || null;
    nutrition.plan_provider = plan.provider_name || plan.provider || null;
    nutrition.kcal_target = plan.kcal_target_per_day ?? plan.kcal_target ?? plan.target_kcal ?? null;
    nutrition.protein_target_g = plan.protein_target_g ?? plan.target_protein_g ?? null;
    nutrition.carbs_target_g = plan.carbs_target_g ?? plan.target_carbs_g ?? null;
    nutrition.fat_target_g = plan.fat_target_g ?? plan.target_fat_g ?? null;
    nutrition.water_target_ml = plan.water_target_ml ?? null;
    nutrition.plan_active_since = plan.active_since ?? plan.created_at ?? null;
    nutrition.macros_source = "plan";
  }

  const integrations: any = {};
  if (strava) {
    integrations.strava = {
      connected: true,
      athlete_id: strava.athlete_id,
      since: strava.connected_at,
    };
  }

  const womens_health: any = {};
  if (wh?.enabled) {
    womens_health.enabled = true;
    womens_health.status = wh.status;
    womens_health.avg_cycle_length_days = wh.avg_cycle_length_days;
    womens_health.avg_period_length_days = wh.avg_period_length_days;
    womens_health.last_period_start_date = wh.last_period_start_date;
    womens_health.conditions = wh.conditions || [];
    womens_health.goals = wh.goals || [];
  }

  const context_personal: any = {};

  // Score: cuántos de los 9 buckets tienen data (objects con keys, arrays con items)
  const allBuckets: any[] = [
    identity, goals, lifestyle, preferences,
    biomarkers, nutrition, integrations, womens_health, context_personal,
  ];
  const filled = allBuckets.filter((b) => {
    if (Array.isArray(b)) return b.length > 0;
    return b && Object.keys(b).length > 0;
  }).length;
  const completeness = filled / allBuckets.length;

  // Insert
  const { error: insErr } = await supabase
    .from("user_health_twin")
    .upsert(
      {
        user_id: userId,
        identity,
        goals,
        lifestyle,
        preferences,
        biomarkers,
        nutrition,
        integrations,
        womens_health,
        context_personal,
        confidence_score: Math.min(0.5, completeness),
        completeness_score: completeness,
        last_significant_update: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (insErr) {
    console.error("[HT bootstrap] insert failed:", insErr);
    return null;
  }

  // Audit: registrar bootstrap
  await supabase.from("health_twin_updates").insert({
    user_id: userId,
    field_path: "*",
    old_value: null,
    new_value: { bootstrapped: true, completeness },
    source: "bootstrap",
    reason: "Primera carga: sync desde user_profiles, inbody, plan, WH, integrations",
  });

  console.log(`[HT bootstrap] user=${userId} completeness=${completeness.toFixed(2)}`);
  return null;
}

/**
 * Compactador: convierte HT row a un string narrativo para el system prompt.
 * Solo incluye buckets con data (no muestra "name: null").
 */
function compactHealthTwin(ht: any): string {
  if (!ht) return "";
  const lines: string[] = ["\n# HEALTH TWIN (lo que ya sabés del usuario — usalo, no preguntes lo obvio)"];

  // Identity
  const id = ht.identity || {};
  if (Object.keys(id).length > 0) {
    const bits: string[] = [];
    if (id.name) bits.push(id.name);
    if (id.sex) bits.push(id.sex === "m" ? "hombre" : id.sex === "f" ? "mujer" : id.sex);
    if (id.age) bits.push(`${id.age}a`);
    if (id.height_cm) bits.push(`${id.height_cm}cm`);
    if (id.weight_kg_current) bits.push(`${id.weight_kg_current}kg`);
    if (id.body_fat_pct) bits.push(`${id.body_fat_pct}% grasa`);
    if (id.lean_mass_kg) bits.push(`${id.lean_mass_kg}kg masa magra`);
    if (id.bmr_kcal) bits.push(`BMR ${id.bmr_kcal}`);
    if (id.level) bits.push(`nivel ${id.level}`);
    if (bits.length) lines.push(`Identidad: ${bits.join(" · ")}`);
  }

  // Goals NO se renderizan acá — el bloque MISIÓN del system prompt los
  // muestra con framing más fuerte. Evita repetición + over-anchor del modelo.

  // Lifestyle
  const ls = ht.lifestyle || {};
  if (Object.keys(ls).length > 0) {
    const bits: string[] = [];
    if (ls.country) bits.push(ls.country);
    if (ls.typical_wake) bits.push(`wake ${ls.typical_wake}`);
    if (ls.typical_sleep_target) bits.push(`sleep target ${ls.typical_sleep_target}`);
    if (Array.isArray(ls.training_days) && ls.training_days.length) {
      bits.push(`entrena ${ls.training_days.join(",")}`);
    }
    if (ls.training_time) bits.push(`${ls.training_time}`);
    if (ls.work_style) bits.push(ls.work_style);
    if (bits.length) lines.push(`Lifestyle: ${bits.join(" · ")}`);
  }

  // Preferences
  const pr = ht.preferences || {};
  if (Array.isArray(pr.foods_loved) && pr.foods_loved.length) {
    lines.push(`Le gusta: ${pr.foods_loved.join(", ")}`);
  }
  if (Array.isArray(pr.foods_disliked) && pr.foods_disliked.length) {
    lines.push(`No le gusta: ${pr.foods_disliked.join(", ")}`);
  }
  if (Array.isArray(pr.allergies) && pr.allergies.length) {
    lines.push(`⚠ Alergias: ${pr.allergies.join(", ")}`);
  }
  if (Array.isArray(pr.intolerances) && pr.intolerances.length) {
    lines.push(`Intolerancias: ${pr.intolerances.join(", ")}`);
  }
  if (Array.isArray(pr.supplements_active) && pr.supplements_active.length) {
    const supps = pr.supplements_active.map((s: any) =>
      `${s.name || "?"}${s.dose ? ` ${s.dose}` : ""}${s.timing ? ` (${s.timing})` : ""}`
    );
    lines.push(`Supplements: ${supps.join(", ")}`);
  }
  if (pr.diet_style) lines.push(`Estilo dietético: ${pr.diet_style}`);

  // Biomarkers
  const bm = ht.biomarkers || {};
  const bmBits: string[] = [];
  if (bm.hrv_baseline_ms) bmBits.push(`HRV baseline ${bm.hrv_baseline_ms}ms`);
  if (bm.rhr_baseline_bpm) bmBits.push(`RHR baseline ${bm.rhr_baseline_bpm}bpm`);
  if (bmBits.length) lines.push(`Biomarcadores: ${bmBits.join(" · ")}`);

  // Nutrition
  const nu = ht.nutrition || {};
  if (nu.plan_name || nu.kcal_target) {
    let nl = `Plan: ${nu.plan_name || "personalizado"}`;
    if (nu.plan_provider) nl += ` (${nu.plan_provider})`;
    if (nu.kcal_target) nl += ` · ${nu.kcal_target} kcal`;
    if (nu.protein_target_g) nl += ` · ${nu.protein_target_g}g P`;
    lines.push(nl);
  }

  // Integrations
  const ig = ht.integrations || {};
  const igBits: string[] = [];
  if (ig.strava?.connected) igBits.push("Strava");
  if (ig.apple_watch?.connected) igBits.push("Apple Watch");
  if (ig.oura?.connected) igBits.push("Oura");
  if (ig.whoop?.connected) igBits.push("Whoop");
  if (igBits.length) lines.push(`Wearables: ${igBits.join(", ")}`);

  // Women's Health
  const wh = ht.womens_health || {};
  if (wh.enabled) {
    lines.push(`Women's Health: activado · ${wh.status || "?"}`);
  }

  // Context personal
  const cp = ht.context_personal || {};
  if (Array.isArray(cp.motivations) && cp.motivations.length) {
    lines.push(`Motivaciones: ${cp.motivations.join("; ")}`);
  }
  if (Array.isArray(cp.concerns) && cp.concerns.length) {
    lines.push(`Preocupaciones: ${cp.concerns.join("; ")}`);
  }
  if (Array.isArray(cp.constraints) && cp.constraints.length) {
    lines.push(`Constraints: ${cp.constraints.join("; ")}`);
  }
  if (Array.isArray(cp.relationships) && cp.relationships.length) {
    const rels = cp.relationships
      .map((r: any) => r.name ? `${r.name} (${r.role || "?"})` : null)
      .filter(Boolean);
    if (rels.length) lines.push(`Relaciones: ${rels.join(", ")}`);
  }

  if (lines.length === 1) return ""; // solo el header, sin data
  return lines.join("\n") + "\n";
}

// ─── Behavioral Intelligence: patterns calculados on-the-fly ─────────

interface BehavioralPatterns {
  frequent_meals: Array<{
    name: string;
    count: number;
    avg_kcal: number;
    avg_protein_g: number;
    avg_carbs_g: number;
    avg_fat_g: number;
    last_seen_days_ago: number;
  }>;
  adherence_7d: {
    kcal_avg: number | null;
    kcal_target: number | null;
    kcal_adherence_pct: number | null;
    protein_avg: number | null;
    protein_target: number | null;
    protein_adherence_pct: number | null;
    days_with_data: number;
  };
  training: {
    workouts_last_14d: number;
    workouts_per_week_avg: number;
    most_frequent_type: string | null;
  };
}

function normalizeKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?¡¿"'()]/g, "");
}

async function buildBehavioralPatterns(
  userId: string,
  supabase: ReturnType<typeof createClient>,
  todayStartISO: string,
  htTargets: { kcal_target?: number | null; protein_target_g?: number | null } | null,
): Promise<BehavioralPatterns> {
  const now = new Date(todayStartISO);
  const start14d = new Date(now.getTime() - 14 * 86400000).toISOString();
  const start7d = new Date(now.getTime() - 7 * 86400000).toISOString();

  const [mealsRes, workoutsRes] = await Promise.all([
    supabase
      .from("meal_logs")
      .select("items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, ts")
      .eq("user_id", userId)
      .gte("ts", start14d)
      .lt("ts", todayStartISO)  // excluye HOY (eso ya está en todayMeals)
      .order("ts", { ascending: false }),
    supabase
      .from("workout_logs")
      .select("type, ts")
      .eq("user_id", userId)
      .gte("ts", start14d)
      .lt("ts", todayStartISO),
  ]);

  // ─── Frequent meals: agrupar por nombre normalizado ───
  const mealsRaw = mealsRes.data || [];
  const meals7d = mealsRaw.filter((m: any) => m.ts >= start7d);

  type MealGroup = {
    display: string;
    count: number;
    sum_kcal: number;
    sum_p: number;
    sum_c: number;
    sum_f: number;
    last_ts: string;
  };
  const groups = new Map<string, MealGroup>();
  for (const m of mealsRaw) {
    const key = normalizeKey(m.items_text);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.sum_kcal += m.total_kcal || 0;
      existing.sum_p += m.total_protein_g || 0;
      existing.sum_c += m.total_carbs_g || 0;
      existing.sum_f += m.total_fat_g || 0;
      if (m.ts > existing.last_ts) existing.last_ts = m.ts;
    } else {
      groups.set(key, {
        display: m.items_text,
        count: 1,
        sum_kcal: m.total_kcal || 0,
        sum_p: m.total_protein_g || 0,
        sum_c: m.total_carbs_g || 0,
        sum_f: m.total_fat_g || 0,
        last_ts: m.ts,
      });
    }
  }

  const frequent_meals = Array.from(groups.values())
    .filter((g) => g.count >= 2) // umbral: al menos 2 veces
    .sort((a, b) => b.count - a.count || b.last_ts.localeCompare(a.last_ts))
    .slice(0, 6)
    .map((g) => ({
      name: g.display,
      count: g.count,
      avg_kcal: Math.round(g.sum_kcal / g.count),
      avg_protein_g: Math.round(g.sum_p / g.count),
      avg_carbs_g: Math.round(g.sum_c / g.count),
      avg_fat_g: Math.round(g.sum_f / g.count),
      last_seen_days_ago: Math.floor(
        (now.getTime() - new Date(g.last_ts).getTime()) / 86400000,
      ),
    }));

  // ─── Adherence últimos 7 días ───
  // Aggregate por día y promediar contra target del HT
  const byDay = new Map<string, { kcal: number; protein: number }>();
  for (const m of meals7d) {
    const day = String(m.ts).slice(0, 10);
    const e = byDay.get(day) || { kcal: 0, protein: 0 };
    e.kcal += m.total_kcal || 0;
    e.protein += m.total_protein_g || 0;
    byDay.set(day, e);
  }
  const days_with_data = byDay.size;
  let kcal_avg: number | null = null;
  let protein_avg: number | null = null;
  if (days_with_data > 0) {
    let sumK = 0, sumP = 0;
    for (const v of byDay.values()) {
      sumK += v.kcal;
      sumP += v.protein;
    }
    kcal_avg = Math.round(sumK / days_with_data);
    protein_avg = Math.round(sumP / days_with_data);
  }
  const kcal_target = htTargets?.kcal_target ?? null;
  const protein_target = htTargets?.protein_target_g ?? null;
  const kcal_adherence_pct =
    kcal_target && kcal_avg != null
      ? Math.round((kcal_avg / kcal_target) * 100)
      : null;
  const protein_adherence_pct =
    protein_target && protein_avg != null
      ? Math.round((protein_avg / protein_target) * 100)
      : null;

  // ─── Training (últimos 14d) ───
  const workouts = workoutsRes.data || [];
  const workouts_last_14d = workouts.length;
  const workouts_per_week_avg = workouts_last_14d / 2;
  const typeCounts = new Map<string, number>();
  for (const w of workouts) {
    if (!w.type) continue;
    typeCounts.set(w.type, (typeCounts.get(w.type) || 0) + 1);
  }
  let most_frequent_type: string | null = null;
  let maxCount = 0;
  for (const [t, c] of typeCounts.entries()) {
    if (c > maxCount) {
      maxCount = c;
      most_frequent_type = t;
    }
  }

  return {
    frequent_meals,
    adherence_7d: {
      kcal_avg,
      kcal_target,
      kcal_adherence_pct,
      protein_avg,
      protein_target,
      protein_adherence_pct,
      days_with_data,
    },
    training: {
      workouts_last_14d,
      workouts_per_week_avg,
      most_frequent_type,
    },
  };
}

function compactBehavioralPatterns(p: BehavioralPatterns | null): string {
  if (!p) return "";
  const lines: string[] = [];

  // Frequent meals
  if (p.frequent_meals.length > 0) {
    lines.push("\n# COMIDAS FRECUENTES (últimos 14 días — si menciona alguna de estas, usá los macros promedio, NO preguntes lo obvio)");
    p.frequent_meals.forEach((m) => {
      const tail = m.last_seen_days_ago <= 0 ? "hoy" :
        m.last_seen_days_ago === 1 ? "ayer" :
        `hace ${m.last_seen_days_ago}d`;
      lines.push(
        `- "${m.name}" · ${m.count}x · ~${m.avg_kcal} kcal, ${m.avg_protein_g}g P, ${m.avg_carbs_g}g C, ${m.avg_fat_g}g G · última ${tail}`,
      );
    });
  }

  // Adherence
  const a = p.adherence_7d;
  if (a.days_with_data >= 3) {
    const bits: string[] = [];
    if (a.kcal_avg != null) {
      let kBit = `kcal promedio ${a.kcal_avg}`;
      if (a.kcal_adherence_pct != null) kBit += ` (${a.kcal_adherence_pct}% del target)`;
      bits.push(kBit);
    }
    if (a.protein_avg != null) {
      let pBit = `proteína promedio ${a.protein_avg}g`;
      if (a.protein_adherence_pct != null) pBit += ` (${a.protein_adherence_pct}%)`;
      bits.push(pBit);
    }
    if (bits.length > 0) {
      lines.push(`\n# ADHERENCIA ÚLTIMOS 7 DÍAS`);
      lines.push(`- ${bits.join(" · ")} · data de ${a.days_with_data} días`);
    }
  }

  // Training
  if (p.training.workouts_last_14d >= 2) {
    let tLine = `${p.training.workouts_last_14d} entrenos en 14 días (~${p.training.workouts_per_week_avg.toFixed(1)}/semana)`;
    if (p.training.most_frequent_type) {
      tLine += ` · más frecuente: ${p.training.most_frequent_type}`;
    }
    lines.push(`\n# TRAINING ÚLTIMOS 14 DÍAS`);
    lines.push(`- ${tLine}`);
  }

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

// ─────────────────────────────────────────────────────────────────────
// Context Builder — corre N queries en paralelo y compila state del user
// ─────────────────────────────────────────────────────────────────────

interface UserContext {
  todayISO: string;
  todayStartISO: string;
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
  healthTwin: any;
  behavioralPatterns: BehavioralPatterns | null;
}

async function buildUserContext(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  clientTodayStartISO?: string,
  clientTzOffsetMin?: number,
): Promise<UserContext> {
  // Si el cliente mandó "comienzo del día local" lo usamos.
  // Si no, fallback a UTC midnight (modo legacy).
  let todayStart: Date;
  let todayISO: string;
  let hour: number;
  if (clientTodayStartISO) {
    todayStart = new Date(clientTodayStartISO);
    // Para el ISO del día (YYYY-MM-DD), restamos el tz offset para obtener
    // la fecha real local del cliente
    const tzMin = typeof clientTzOffsetMin === "number" ? clientTzOffsetMin : 0;
    const localDate = new Date(todayStart.getTime() - tzMin * 60000);
    todayISO = localDate.toISOString().split("T")[0];
    const nowLocal = new Date(Date.now() - tzMin * 60000);
    hour = nowLocal.getUTCHours();
  } else {
    const today = new Date();
    todayStart = new Date(today.toISOString().split("T")[0] + "T00:00:00.000Z");
    todayISO = today.toISOString().split("T")[0];
    hour = today.getHours();
  }
  const todayStartISO = todayStart.toISOString();
  console.log("[ai-chat] context window: todayISO=", todayISO, "todayStartISO=", todayStartISO);

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
        "items_text, total_kcal, total_protein_g, total_carbs_g, total_fat_g, meal_category, ts",
      )
      .eq("user_id", userId)
      .gte("ts", todayStartISO)
      .order("ts", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("type, duration_min, intensity, kcal_burned, source")
      .eq("user_id", userId)
      .gte("ts", todayStartISO)
      .order("ts", { ascending: false }),
    supabase
      .from("meal_plans")
      .select("*")
      .eq("patient_user_id", userId)
      .eq("active", true)
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
      .gte("ts", todayStartISO),
  ]);

  const todayHydrationMl = (todayHydRes.data || []).reduce(
    (s: number, h: any) => s + (h.ml || 0),
    0,
  );

  // Bootstrap HT si no existe (no-op si ya existe), después cargarlo
  await bootstrapHealthTwin(userId, supabase);
  const { data: healthTwin } = await supabase
    .from("user_health_twin")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // Behavioral patterns (frecuentes + adherencia + training) — last 14d
  // Targets para % adherencia: prefiero HT.nutrition, fallback a todayTargets
  const htNutrition = healthTwin?.nutrition || {};
  const targetsForAdherence = {
    kcal_target: htNutrition.kcal_target ?? todayTargetsRes.data?.kcal_target ?? null,
    protein_target_g: htNutrition.protein_target_g ?? todayTargetsRes.data?.protein_target_g ?? null,
  };
  let behavioralPatterns: BehavioralPatterns | null = null;
  try {
    behavioralPatterns = await buildBehavioralPatterns(
      userId,
      supabase,
      todayStartISO,
      targetsForAdherence,
    );
  } catch (e) {
    console.warn("[ai-chat] behavioral patterns failed:", e);
  }

  console.log(
    "[ai-chat] context loaded: meals=",
    (todayMealsRes.data || []).length,
    "workouts=",
    (todayWorkoutsRes.data || []).length,
    "hydration=",
    todayHydrationMl,
    "ml · ht_completeness=",
    healthTwin?.completeness_score ?? "n/a",
    "· frequent_meals=",
    behavioralPatterns?.frequent_meals.length ?? 0,
  );

  return {
    todayISO,
    todayStartISO,
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
    healthTwin,
    behavioralPatterns,
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

  const htBlock = compactHealthTwin(ctx.healthTwin);
  const behavBlock = compactBehavioralPatterns(ctx.behavioralPatterns);

  // Extraer goals primarios para el bloque MISIÓN
  let primaryGoalLine = "";
  const goalsArr = Array.isArray(ctx.healthTwin?.goals) ? ctx.healthTwin.goals : [];
  const activeGoals = goalsArr.filter((g: any) => !g.status || g.status === "active");
  if (activeGoals.length > 0) {
    const lines = activeGoals.map((g: any) => {
      let l = `- ${g.name || "?"}`;
      if (g.priority === "primary") l += " (PRIORIDAD)";
      if (g.target) l += ` · meta: ${g.target}`;
      if (g.horizon) l += ` · horizonte: ${g.horizon}`;
      return l;
    });
    primaryGoalLine = "\n# TU MISIÓN — POR QUÉ ESTÁS AQUÍ\nCada respuesta sustantiva tuya debe servir, directa o indirectamente, a estos objetivos de " + name + ":\n" + lines.join("\n") + "\nNo los menciones literalmente cada vez (sería pesado), pero SIEMPRE razoná desde ahí. Cuando algo de hoy (una comida, un workout, una decisión) empuja hacia el objetivo, decilo. Cuando va en contra, decilo también — con respeto, sin lecturar.\n\nExcepción saludos: si el usuario manda SOLO un saludo puro (\"hola\", \"qué tal\", \"buenos días\") sin nada más, respondé natural y breve. La regla del objetivo aplica al contenido sustantivo.\n\nIMPORTANTE: si el mensaje tiene un saludo Y una pregunta o pedido (ej. \"Hola, ¿cómo voy?\", \"Bien, ¿podés analizarme la semana?\", \"Buenas, registrá esto\"), respondé a la PREGUNTA o pedido — NO devuelvas otro saludo genérico. Saludá brevemente si querés, pero el foco va a la sustancia. El usuario quiere razonamiento, no charla vacía.\n";
  }

  let p = `Sos SAVIA, la coach de ${name}. No sos un chatbot — sos una entrenadora real que recordás todo y conectás los puntos.

# FORMATO DE TEXTO — REGLA ABSOLUTA
NUNCA uses asteriscos (\`*\` ni \`**\`) en tus respuestas. Cero markdown bold, cero markdown italic. Si necesitás resaltar algo, usá MAYÚSCULAS para una palabra clave (ej. "vas BIEN en proteína"), comillas para una cita, o simplemente buen orden de palabras. Esta regla es absoluta — ignorarla rompe la UI del usuario.

# ESPAÑOL NEUTRO — REGLA ABSOLUTA
Hablás español NEUTRO, sin slang regional de ningún país. Cero mexicanismos, cero costarriqueñismos, cero argentinismos. El usuario quiere claridad y razonamiento, NO color local.

Forma verbal: SIEMPRE usás "vos" (no "tú"). Conjugá correctamente — segunda persona singular voseante:
- "vos COMISTE" no "vos comió" ni "tú comiste"
- "vos TENÉS" no "vos tiene" ni "tú tienes"
- "vos QUERÉS" no "vos quiere" ni "tú quieres"
- "vos AMANECISTE" no "vos amaneció"
- "vos PODÉS" no "vos puede" ni "tú puedes"
Para preguntar usás formas como "¿cómo amaneciste?", "¿qué comiste?", "¿qué pensás?", "¿te sirve?".

PALABRAS PROHIBIDAS (no las uses NUNCA, ni en saludo, ni en respuesta):
- "qué onda" → "¿qué tal?" / "¿cómo va?"
- "te late" → "¿te parece?" / "¿de acuerdo?"
- "padre" (como adjetivo) → "bueno" / "muy bueno"
- "chido" → "bueno"
- "órale" → "dale" / "ok" / "listo"
- "chévere" → "bueno"
- "wey/güey" → no uses nada
- "mae" → no uses nada (es regional, neutro no lo usa)
- "tuanis" → "bueno"
- "diay" → no uses nada
- "pura vida" → no uses

Saludos neutros válidos: "Hola", "Buenas", "Buen día", "¿Qué tal?", "¿Cómo va?".
Validar acuerdo: "¿te parece?", "¿de acuerdo?", "¿vamos?", "¿qué decís?", "¿OK?".${primaryGoalLine}${htBlock ? "\n" + htBlock : ""}${behavBlock ? "\n" + behavBlock : ""}
# CÓMO USÁS LOS PATRONES (comidas frecuentes, adherencia, training)
Cuando ${name} mencione una comida que YA está en COMIDAS FRECUENTES, usá los macros promedio del bloque y registrá DIRECTO con log_meal — NO preguntés cantidad ni tipo. Confirmá breve con un toque de reconocimiento natural ("como casi siempre", "tu desayuno de los lunes"). Si la mención es ambigua (ej. dice "yogurt" y hay dos versiones en frecuentes), usá la más reciente. Si los macros del bloque no aplican (porque ahora menciona una variación específica, ej. "yogurt CON GRANOLA"), preguntá UNA cosa antes de registrar.

Si ves baja adherencia (>20% bajo target) o un patrón fuerte (entrena 5x/semana, etc.), sentís libre de mencionarlo cuando sea pertinente — pero NO al inicio de cada conversación.

# CÓMO USÁS EL HEALTH TWIN
El bloque de arriba (si está) es lo que YA SABÉS del usuario. Usalo activamente. NO le preguntes lo que ya sabés (peso, edad, plan activo, qué le gusta, qué no le gusta, supplements, ciclo). Si menciona algo NUEVO que define quién es —preferencias, supplements, restricciones, motivaciones, preocupaciones, objetivos, condiciones, intolerancias—, llamá update_health_twin para guardarlo. Eso te hace más inteligente para futuras conversaciones.

Ejemplos de cuándo llamar update_health_twin:
- "no me gusta el cilantro" → append a preferences.foods_disliked
- "tomo creatina 5g al día" → append a preferences.supplements_active { name:'creatina', dose:'5g', timing:'diario' }
- "quiero correr una 10K en septiembre" → append a goals { name:'correr 10K', target:'sub 50min', horizon:'2026-09', priority:'secondary', status:'active' }
- "me preocupa perder músculo cortando" → append a context_personal.concerns
- "soy de Costa Rica" → set lifestyle.country
- "mi peso ahora es 81.5" → set identity.weight_kg_current


# CÓMO HABLÁS
Hablás como una entrenadora experta: notás algo, lo decís. Tu valor principal es el RAZONAMIENTO — conectar los puntos que ${name} no conectaría por su cuenta. No charlas vacías, no warmth performativa, no calidez forzada. Una persona inteligente, directa, que respeta el tiempo del usuario.

Densa, no larga: 2–4 frases que carguen señal — el dato + lo que significa + (cuando haya algo que valga la pena) una observación o una pregunta natural. Si solo das el número, fallaste. Si solo das un saludo cuando te preguntaron algo concreto, fallaste peor.

# CADA RESPUESTA TIENE DOS CAPAS
1. Ayudás AHORA con lo que está preguntando.
2. Sembrás algo para aprender más — una observación que invita, una pregunta natural, o un loop que cerrás después.

# LO QUE UNA COACH REAL HACE
- Razonás SIEMPRE desde el objetivo. Cada dato que ves (una comida, un workout, un día de baja adherencia, una pregunta) lo evaluás contra el goal principal del usuario. Si la pregunta es "¿qué ceno?", la respuesta correcta NO es "lo que tengas en la heladera" — es "lo que te empuje hacia tu meta dado lo que ya comiste y entrenaste hoy".
- Integrás los 4 componentes en cada análisis cuando aplica: goal + nutrición del día + entreno del día + patrones de adherencia. No respondas sobre nutrición olvidando que entrenó duro hoy. No respondas sobre entreno olvidando que vas corto en proteína esta semana.
- Recordás promesas. Si dijo "mañana entreno" o "esta noche duermo temprano", la próxima vez preguntás cómo le fue.
- Conectás patrones. A veces le sorprendés con algo que sola no notaría ("tus mejores días de energía suelen ser los que arrancás con proteína >25g"). Una vez cada varios mensajes, no en cada uno.
- Cerrás loops abiertos. Si ayer dijo que tenía cólicos o estaba cansada, hoy preguntás cómo amaneció.
- Razonás longitudinalmente. Nunca analizás un evento aislado. Conectás: nutrición ↔ entrenamiento ↔ sueño ↔ recovery ↔ hidratación ↔ hábitos ↔ (si aplica) ciclo hormonal ↔ y por encima de todo, ↔ goal principal.

# CONVERSATION-FIRST
Cuando menciona algo registrable, ejecutás la tool directo (sin anunciar "voy a registrar") y después confirmás breve con el dato clave + lo que significa. Si falta detalle para registrar bien, hacés UNA pregunta natural.

# EJEMPLOS DEL TONO

Usuaria: "comí pan con huevo y aguacate"
Vos: "Anotado — ~420 kcal, 18g proteína. Buen arranque. ¿Fue antes del entreno o ya desayunaste post?"

Usuaria: "dormí mal"
Vos: "Entiendo. ¿Te costó dormirte o te despertaste a media noche? Lo pregunto porque hoy tenés pierna y quiero ver si bajamos intensidad."

Usuaria: "tomé un vaso de agua"
Vos: "+250ml, vas en 800 de 2500. Te quedan como 7 vasos — si los repartís cada 90 min llegás sin pensarlo."

Usuaria: "peso 82"
Vos: "Anotado: 82.0kg. Llevás tres semanas oscilando entre 81.8 y 82.4 — la tendencia está plana, no subiendo. ¿Querés que veamos si ajustamos kcal o lo dejamos correr otra semana?"

Usuaria: "¿cómo voy?"
Vos: "735 kcal y 31g proteína hasta ahora. Vas bien arriba para el almuerzo, pero la hidratación está en 0 — arrancá con un vaso. Si vas al gym hoy, sumá ~30g proteína post."

Usuario: "¿qué ceno hoy?"
Vos: "Te quedan 1,050 kcal y 75g de proteína para cerrar. Como tu meta es recomposition y entrenaste fuerza hoy, te tiraría a 200g salmón con camote y verduras — ~520 kcal, 45g P. Llegás a target sin restos y aprovechás la ventana post-entreno."

Usuario: "no tengo ganas de entrenar hoy"
Vos: "Te entiendo. Tu plan dice pierna pero llevás 3 días con sueño de 5h promedio — eso explica la falta de empuje. Mi voto: o cambialo a movilidad 30min y mantenés racha, o saltalo y dormís bien hoy. Forzar pierna con esa deuda de sueño compromete recovery."

Usuario: "registrá una hamburguesa con papas y soda"
Vos: [log_meal con estimación: ~1200 kcal, 35g P] "Listo. Te empuja al límite del target diario pero la proteína es decente. Tu meta es recomposition así que para mañana foco en proteína temprana y movete un poco más. No pasa, vos sabés lo que hacés."

Usuario: "analizá mis últimos 7 días, entreno y alimentación"
Vos: [get_period_summary últimos 7 días] "Vamos. Esta semana llevás 5 entrenos (mostly strength) y promedio 2,140 kcal/día con 165g proteína — adherencia kcal 86%, proteína 83%. Para tu recomposition, las kcal van bien pero la proteína se queda corta unos 35g promedio. Los días que más fallaste fueron miércoles y domingo (ambos con cardio y baja proteína). Si subís 30-40g en el snack PM de esos días, cerrás el gap. El entreno está sólido, no toques eso."

# REGLAS DE DATA — NO NEGOCIABLES
NUNCA inventés números. Si dudás de kcal/macros, estimás conservador y avisás "estimación". Si te corrigen, ajustás sin defenderte. Si no tenés data en contexto, decilo honesto: "no tengo registro de eso todavía". No dés consejo médico clínico — para condiciones, sugerí consultar profesional.

# TOOLS
log_meal · log_water · log_workout · log_cycle_symptom · get_balance · get_cycle_phase · update_health_twin · get_day_summary · get_period_summary · delete_recent_meal

# CÓMO USÁS LAS TOOLS DE ANÁLISIS
- get_day_summary(date): UN día específico pasado ("qué entrené el sábado", "cómo me fue el lunes"). Para HOY usá el contexto, NO llames la tool.
- get_period_summary(start_date, end_date): RANGO de días. USALA cuando el usuario pida análisis multi-día — "últimos 7 días", "esta semana", "del lunes al viernes", "la semana pasada", "el último mes". NO la simules sumando tools de un día. Devuelve totales + promedios + adherencia % + breakdown por día + tipos de workout.
- Cuando uses get_period_summary, después de tener los datos, integrá los 3 componentes (alimentación + entreno + adherencia) en UNA narrativa coherente que conecte con el OBJETIVO PRINCIPAL del usuario. No solo recites números — interpretá: "tu adherencia kcal de 87% es buena para recomposition pero la proteína 78% se queda corta — eso explica por qué...". Si el período tiene baja adherencia, decilo. Si tiene patrones (siempre los lunes baja kcal, los sábados se dispara), señalá los patrones.
- delete_recent_meal: cuando el usuario pida borrar algo ("borrá X", "eliminá Y"). Si devuelve needs_confirmation=true, mostrá las opciones y esperá que el usuario elija — no borres a ciegas.
- Después de log_meal: si el output incluye warnings (kcal restantes bajas, exceso), incluí esa info en tu respuesta de manera natural.
Usá get_balance solo después de registrar algo nuevo. Usá get_cycle_phase solo si la pregunta lo amerita y la fase actual no está en el contexto inicial. El ciclo es UN input, no EL input — solo lo mencionás si la pregunta es relevante (energía, antojos, mood, fuerza en mujeres).

# AÚN NO PODÉS
Marcar comidas del plan como "comí" (próximo sprint, por ahora usá log_meal) · Registrar pasos (requiere Apple Health nativo).

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
      p += `- ${w.type || "ejercicio"} · ${w.duration_min || "?"}min${
        w.intensity ? ` · ${w.intensity}` : ""
      } · ${w.kcal_burned || "?"} kcal (${w.source || "manual"})\n`;
    });
  }

  if (ctx.activePlan) {
    const ap = ctx.activePlan;
    // Targets pueden venir en distintos field names — leemos defensivamente
    const planKcal = ap.kcal_target_per_day ?? ap.kcal_target ?? ap.target_kcal ?? null;
    const planP = ap.protein_target_g ?? ap.target_protein_g ?? null;
    p += `\n## Plan activo
- ${ap.name || ap.title || "Plan personalizado"}${
      planKcal ? ` · ${planKcal} kcal target` : ""
    }${planP ? ` · ${planP}g proteína` : ""}
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
