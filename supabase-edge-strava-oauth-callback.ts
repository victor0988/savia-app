// =========================================================
// SAVIA Edge Function: strava-oauth-callback
// Recibe el `code` del OAuth de Strava, intercambia por tokens,
// guarda en wearable_connections.
//
// DEPLOY:
//   1. supabase secrets set STRAVA_CLIENT_ID=tu_client_id_aqui
//   2. supabase secrets set STRAVA_CLIENT_SECRET=tu_secret_aqui
//   3. mkdir -p supabase/functions/strava-oauth-callback
//   4. cp supabase-edge-strava-oauth-callback.ts supabase/functions/strava-oauth-callback/index.ts
//   5. supabase functions deploy strava-oauth-callback
//
// LLAMADA desde el cliente:
//   POST /functions/v1/strava-oauth-callback con { code: "abc123" }
//   Requires user JWT (Supabase auto-validates).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const clientId = Deno.env.get("STRAVA_CLIENT_ID");
  const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!clientId || !clientSecret) {
    return json({ error: "server_misconfigured", detail: "missing Strava credentials" }, 500);
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    return json({ error: "server_misconfigured", detail: "missing Supabase service key" }, 500);
  }

  // Validar JWT del user (Supabase ya valida con --verify-jwt default, pero extraemos user_id)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth" }, 401);
  const userToken = authHeader.replace("Bearer ", "");

  // Validar y extraer user_id del JWT
  let userId: string;
  try {
    const meResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseServiceKey, Authorization: authHeader },
    });
    if (!meResp.ok) throw new Error("invalid_jwt");
    const userData = await meResp.json();
    userId = userData.id;
  } catch (e) {
    return json({ error: "invalid_user" }, 401);
  }

  // Parsear body
  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.code) return json({ error: "missing_code" }, 400);

  // Intercambiar code por access_token + refresh_token
  let tokens: any;
  try {
    const tokenResp = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: body.code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      const detail = await tokenResp.text();
      console.error("Strava token exchange failed:", tokenResp.status, detail);
      return json({ error: "strava_token_exchange_failed", detail: detail.slice(0, 300) }, 502);
    }
    tokens = await tokenResp.json();
  } catch (e) {
    return json({ error: "strava_unreachable", message: String(e) }, 502);
  }

  // tokens shape:
  // {
  //   "token_type": "Bearer",
  //   "expires_at": 1568775134,
  //   "expires_in": 21600,
  //   "refresh_token": "...",
  //   "access_token": "...",
  //   "athlete": { id, firstname, lastname, profile, ... }
  // }

  const athlete = tokens.athlete || {};
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : null;

  // UPSERT en wearable_connections (1 conexión Strava por user)
  try {
    const upsertResp = await fetch(`${supabaseUrl}/rest/v1/wearable_connections`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: userId,
        provider: "strava",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scope: tokens.scope || null,
        external_user_id: athlete.id ? String(athlete.id) : null,
        external_username: athlete.username || (athlete.firstname && athlete.lastname ? `${athlete.firstname} ${athlete.lastname}`.trim() : null),
        external_avatar_url: athlete.profile_medium || athlete.profile || null,
        external_profile_raw: athlete,
        status: "active",
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsertResp.ok) {
      const detail = await upsertResp.text();
      console.error("UPSERT wearable_connections failed:", upsertResp.status, detail);
      return json({ error: "save_failed", detail: detail.slice(0, 300) }, 500);
    }
    const [saved] = await upsertResp.json();
    return json({
      ok: true,
      provider: "strava",
      athlete_name: saved.external_username,
      athlete_avatar: saved.external_avatar_url,
      connected_at: saved.connected_at,
    });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
});
