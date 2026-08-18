import { createClient } from "npm:@supabase/supabase-js@2";

const allowedRoles = ["Builder", "Defender", "Analyst", "Designer", "Strategist"];
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://low-key-n.github.io")
  .split(",").map((origin) => origin.trim());

function response(status: number, body: object, origin: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "Vary": "Origin" };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

const safeStrings = (value: unknown, maxItems: number, maxLength: number) => Array.isArray(value)
  ? value.filter((item) => typeof item === "string").slice(0, maxItems).map((item) => item.slice(0, maxLength))
  : [];

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method !== "GET") return response(405, { error: "Method not allowed." }, origin);
  if (origin && !allowedOrigins.includes(origin)) return response(403, { error: "Origin not allowed." }, origin);

  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secretKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secretKey) return response(503, { error: "Team board is temporarily unavailable." }, origin);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("public_teams")
    .select("id,team_name,member_first_names,member_roles,roles_needed,approved_project_interests,capacity")
    .eq("publication_status", "published").order("display_order").order("published_at").limit(50);
  if (error) return response(503, { error: "Team board is temporarily unavailable." }, origin);

  const teams = (data || []).map((team) => {
    const names = safeStrings(team.member_first_names, 8, 50);
    const roles = safeStrings(team.member_roles, 8, 20).filter((role) => allowedRoles.includes(role));
    const memberCount = Math.min(names.length, roles.length, Number(team.capacity));
    return {
      id: team.id,
      teamName: String(team.team_name).slice(0, 80),
      members: names.slice(0, memberCount).map((firstName, index) => ({ firstName, role: roles[index] })),
      rolesNeeded: safeStrings(team.roles_needed, 5, 20).filter((role) => allowedRoles.includes(role)),
      projectInterests: String(team.approved_project_interests || "").slice(0, 300),
      capacity: Math.max(2, Math.min(8, Number(team.capacity))),
    };
  });
  return response(200, { teams }, origin);
});
