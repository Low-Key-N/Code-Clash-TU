import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://codeclashtu.com,http://localhost:8000")
  .split(",").map((origin) => origin.trim());

function response(status: number, body: object, origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60, s-maxage=300",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method !== "GET") return response(405, { error: "Method not allowed." }, origin);
  if (origin && !allowedOrigins.includes(origin)) return response(403, { error: "Origin not allowed." }, origin);

  let secretKeys: Record<string, string> = {};
  try { secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); } catch { /* Fail closed below. */ }
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || secretKeys.default;
  if (!secretKey) return response(503, { error: "Club standings are temporarily unavailable." }, origin);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("get_club_standings");
  if (error) {
    console.error("get_club_standings failed", error.code, error.message);
    return response(503, { error: "Club standings are temporarily unavailable." }, origin);
  }

  const clubs = (data || []).map((club: Record<string, unknown>) => ({
    slug: String(club.slug || "").slice(0, 80),
    name: String(club.name || "").slice(0, 100),
    registered: Math.max(0, Number(club.registered) || 0),
    submissions: Math.max(0, Number(club.submissions) || 0),
  }));
  return response(200, { clubs }, origin);
});
