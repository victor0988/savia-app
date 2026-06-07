// =========================================================
// SAVIA Edge Function: strava-sync-activities
// Trae activities recientes de Strava y las inserta en workout_logs.
// Maneja: refresh de token si expiró, dedup por external_id, mapeo de tipos.
//
// DEPLOY:
//   mkdir -p supabase/functions/strava-sync-activities
//   cp supabase-edge-strava-sync-activities.ts supabase/functions/strava-sync-activities/index.ts
//   supabase functions deploy strava-sync-activities
//
// LLAMADA desde el cliente: POST con { since_days?: 7 } opcional (default 30).
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

// Strava activity type → SAVIA workout type
const TYPE_MAP: Record<string, string> = {
  Run: "run",
  TrailRun: "run",
  Ride: "bike",
  VirtualRide: "bike",
  MountainBikeRide: "bike",
  Swim: "swim",
  Walk: "walk",
  Hike: "walk",
  WeightTraining: "strength",
  Workout: "strength",
  Crossfit: "hiit",
  HighIntensityIntervalTraining: "hiit",
  Yoga: "yoga",
  Rowing: "cardio",
  Elliptical: "cardio",
  StairStepper: "cardio",
};

const INTENSITY_MAP_BY_HR = (hr: number | null): string => {
  if (!hr) return "moderate";
  if (hr < 120) return "light";
  if (hr < 160) return "moderate";
  return "vigorous";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const clientId = Deno.env.get("STRAVA_CLIENT_ID");
  const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth" }, 401);

  // Extraer user_id del JWT
  let userId: string;
  try {
    const meResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseServiceKey, Authorization: authHeader },
    });
    if (!meResp.ok) throw new Error("invalid_jwt");
    const userData = await meResp.json();
    userId = userData.id;
  } catch {
    return json({ error: "invalid_user" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const sinceDays = Math.min(Math.max(parseInt(body.since_days) || 30, 1), 365);

  const syncStart = Date.now();
  const syncLog = {
    user_id: userId,
    provider: "strava",
    status: "failed",
    trigger: body.trigger || "manual",
    activities_fetched: 0,
    activities_inserted: 0,
    activities_skipped: 0,
    api_calls: 0,
    duration_ms: 0,
    error_message: null as string | null,
    connection_id: null as string | null,
    started_at: new Date().toISOString(),
    finished_at: null as string | null,
  };

  try {
    // 1) Traer connection del user
    const connResp = await fetch(
      `${supabaseUrl}/rest/v1/wearable_connections?user_id=eq.${userId}&provider=eq.strava&status=eq.active&select=*&limit=1`,
      { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
    );
    if (!connResp.ok) throw new Error("connection_fetch_failed");
    const conns = await connResp.json();
    if (!conns.length) return json({ error: "no_connection", message: "Connect Strava first" }, 404);
    const conn = conns[0];
    syncLog.connection_id = conn.id;

    // 2) Refresh token si expiró
    let accessToken = conn.access_token;
    const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
    const now = Date.now();
    if (expiresAt < now + 5 * 60 * 1000) {
      // Refrescar (Strava recomienda 5 min antes)
      const refreshResp = await fetch("https://www.strava.com/api/v3/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: conn.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      syncLog.api_calls++;
      if (!refreshResp.ok) {
        const det = await refreshResp.text();
        throw new Error("refresh_failed: " + det.slice(0, 200));
      }
      const newTokens = await refreshResp.json();
      accessToken = newTokens.access_token;
      // Actualizar DB
      await fetch(`${supabaseUrl}/rest/v1/wearable_connections?id=eq.${conn.id}`, {
        method: "PATCH",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_at: new Date(newTokens.expires_at * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }

    // 3) Fetch activities desde Strava
    const afterTs = Math.floor((now - sinceDays * 86400000) / 1000);
    const activities: any[] = [];
    let page = 1;
    const perPage = 50;
    while (page <= 4) { // hasta 200 activities max
      const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterTs}&per_page=${perPage}&page=${page}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      syncLog.api_calls++;
      if (!r.ok) {
        const det = await r.text();
        throw new Error(`strava_api_error_${r.status}: ${det.slice(0, 200)}`);
      }
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      activities.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }
    syncLog.activities_fetched = activities.length;

    // 4) Insertar en workout_logs con dedup
    if (activities.length > 0) {
      const externalIds = activities.map(a => String(a.id));
      const existingResp = await fetch(
        `${supabaseUrl}/rest/v1/workout_logs?user_id=eq.${userId}&source=eq.strava&external_id=in.(${externalIds.join(",")})&select=external_id`,
        { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
      );
      const existing = existingResp.ok ? await existingResp.json() : [];
      const existingSet = new Set(existing.map((e: any) => e.external_id));

      const rowsToInsert = activities
        .filter(a => !existingSet.has(String(a.id)))
        .map(a => ({
          user_id: userId,
          ts: a.start_date,
          type: TYPE_MAP[a.sport_type || a.type] || "other",
          name: a.name || null,
          duration_min: Math.round((a.moving_time || a.elapsed_time || 0) / 60),
          intensity: INTENSITY_MAP_BY_HR(a.average_heartrate),
          kcal_burned: a.calories ? Math.round(a.calories) : (a.kilojoules ? Math.round(a.kilojoules * 0.9) : null),
          distance_km: a.distance ? Math.round(a.distance / 10) / 100 : null,
          distance_m: a.distance || null,
          elevation_gain_m: a.total_elevation_gain || null,
          avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
          max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
          avg_speed_mps: a.average_speed || null,
          source: "strava",
          external_id: String(a.id),
          external_url: `https://www.strava.com/activities/${a.id}`,
          started_at: a.start_date,
          sport_type: a.sport_type || a.type,
          raw_data: a,
          notes: a.description || null,
        }));

      syncLog.activities_skipped = activities.length - rowsToInsert.length;

      if (rowsToInsert.length > 0) {
        const insResp = await fetch(`${supabaseUrl}/rest/v1/workout_logs`, {
          method: "POST",
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(rowsToInsert),
        });
        if (!insResp.ok) {
          const det = await insResp.text();
          throw new Error("workout_logs_insert: " + det.slice(0, 200));
        }
        syncLog.activities_inserted = rowsToInsert.length;
      }
    }

    // 5) Actualizar last_sync + counter en connection
    await fetch(`${supabaseUrl}/rest/v1/wearable_connections?id=eq.${conn.id}`, {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        last_sync_at: new Date().toISOString(),
        last_error: null,
        total_activities_synced: (conn.total_activities_synced || 0) + syncLog.activities_inserted,
        updated_at: new Date().toISOString(),
      }),
    });

    syncLog.status = syncLog.activities_inserted > 0 ? "success" : "no_new_data";
  } catch (e) {
    syncLog.status = "failed";
    syncLog.error_message = String(e).slice(0, 500);
  } finally {
    syncLog.duration_ms = Date.now() - syncStart;
    syncLog.finished_at = new Date().toISOString();
    // Best-effort sync log insert (no falla si esto falla)
    if (syncLog.connection_id) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/wearable_sync_log`, {
          method: "POST",
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(syncLog),
        });
      } catch {}
    }
  }

  return json({
    ok: syncLog.status !== "failed",
    fetched: syncLog.activities_fetched,
    inserted: syncLog.activities_inserted,
    skipped: syncLog.activities_skipped,
    api_calls: syncLog.api_calls,
    duration_ms: syncLog.duration_ms,
    error: syncLog.error_message,
  });
});
