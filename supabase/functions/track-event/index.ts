// =====================================================================
// SAVIA Track Event — Sprint 1.C
// =====================================================================
// Endpoint mínimo para que el cliente registre eventos de telemetría.
// El insert va vía service_role (RLS bloquea inserts directos del user).
//
// Body: { event_name: string, metadata?: object }
// Auth: requiere Authorization Bearer del user (valida que el evento es suyo).
//
// Idempotencia para eventos "first_*": el cliente decide si dispararlos,
// pero el servidor NO deduplica activamente — confía en el cliente y
// cualquier duplicado es tolerable (queries pueden hacer MIN/DISTINCT).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_EVENTS = new Set([
  "signup",
  "onboarding_completed",
  "session_active",
  "first_log_meal",
  "first_log_water",
  "first_log_workout",
  "first_coach_interaction",
  "first_pulse_opened",
  "coach_memory_reference",
  "pattern_insight_shown",
  "morning_pulse_opened",
  "evening_pulse_opened",
  "weekly_review_opened",
  "inbody_review_chat_opened",
  // Sprint 3.B.ext.1 — Transformation chapters
  "chapter_created",
  "chapter_opened",
  "chapter_chat_opened",
]);

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Missing Authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnon || !serviceKey) {
      return jsonError("Server misconfigured", 500);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const event_name: string | undefined = body?.event_name;
    const metadata: Record<string, unknown> | undefined = body?.metadata;

    if (!event_name || typeof event_name !== "string") {
      return jsonError("event_name es requerido");
    }
    if (!ALLOWED_EVENTS.has(event_name)) {
      return jsonError(`event_name desconocido: ${event_name}`);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { error: insErr } = await supabaseAdmin.from("user_events").insert({
      user_id: user.id,
      event_name,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    });

    if (insErr) {
      console.error("[track-event] insert error:", insErr);
      return jsonError("Failed to track event", 500);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[track-event] uncaught:", err);
    return jsonError("Internal error", 500);
  }
});
