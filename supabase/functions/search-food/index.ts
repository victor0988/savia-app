// =========================================================
// SAVIA Edge Function: search-food
// Proxy con CORS abierto sobre Open Food Facts.
// OFF NO permite CORS en sus search endpoints, así que el browser no
// puede llamarlos directo. Esta function los llama server-side.
//
// DEPLOY (una sola vez):
//   1. brew install supabase/tap/supabase   (si no lo tenés)
//   2. cd "/Users/victor.lacayo/Documents/Claude/Projects/App de Peptidos"
//   3. supabase login
//   4. supabase link --project-ref vlzzgttjrpyywmahwooi
//   5. mkdir -p supabase/functions/search-food
//   6. cp supabase-edge-search-food.ts supabase/functions/search-food/index.ts
//   7. supabase functions deploy search-food --no-verify-jwt
//
// TEST manual:
//   curl 'https://vlzzgttjrpyywmahwooi.supabase.co/functions/v1/search-food?q=yogurt' \
//     -H 'apikey: YOUR_ANON_KEY'
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const UA = "SAVIA/1.0 (https://usesavia.com; victor.lacayob@gmail.com)";
const FIELDS = "code,product_name,product_name_es,brands,nutriments,image_small_url";
const PAGE_SIZE = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "public, max-age=300",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) return json({ hits: [], reason: "query_too_short" });
  if (q.length > 100) return json({ error: "query_too_long" }, 400);

  const enc = encodeURIComponent(q);
  const primary = `https://search.openfoodfacts.org/search?q=${enc}&page_size=${PAGE_SIZE}&fields=${FIELDS}`;
  const fallback = `https://world.openfoodfacts.org/api/v2/search?search_terms=${enc}&page_size=${PAGE_SIZE}&json=1&fields=${FIELDS}`;

  const headers = { "User-Agent": UA, "Accept": "application/json" };

  const fetchWithTimeout = async (u: string, ms = 4000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(u, { headers, signal: ctrl.signal });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      console.warn("search-food fetch failed:", u, e);
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  // Search-a-licious primario, v2 fallback
  let body = await fetchWithTimeout(primary);
  if (!body) body = await fetchWithTimeout(fallback);
  if (!body) return json({ error: "upstream_unavailable", hits: [] }, 503);

  // Normalizamos: siempre devolvemos {hits: [...]} (shape de search-a-licious)
  return json({ hits: body.hits || body.products || [] });
});
