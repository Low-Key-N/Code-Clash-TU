import { createClient } from "npm:@supabase/supabase-js@2";

const allowedRoles = ["Builder", "Defender", "Analyst", "Designer", "Strategist"] as const;
const allowedExperience = ["Beginner", "Intermediate", "Advanced"];
const allowedTeamStatus = ["solo", "creating", "joining"];
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://low-key-n.github.io")
  .split(",").map((origin) => origin.trim());

const json = (status: number, body: object, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Vary": "Origin",
  },
});

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const optional = (value: unknown, max: number) => clean(value, max) || null;
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const uniqueAllowedRoles = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.filter((role): role is typeof allowedRoles[number] =>
      typeof role === "string" && (allowedRoles as readonly string[]).includes(role)))]
  : [];

async function hashSource(value: string) {
  const salt = Deno.env.get("RATE_LIMIT_SALT");
  if (!salt) throw new Error("RATE_LIMIT_SALT is not configured");
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return json(403, { error: "Origin not allowed." }, origin);
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }});
  }
  if (request.method !== "POST") return json(405, { error: "Method not allowed." }, origin);
  if (!origin || !allowedOrigins.includes(origin)) return json(403, { error: "Origin not allowed." }, origin);
  if (Number(request.headers.get("content-length") || 0) > 16_384) return json(413, { error: "Request is too large." }, origin);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json(400, { error: "Invalid request." }, origin); }
  if (JSON.stringify(body).length > 16_384) return json(413, { error: "Request is too large." }, origin);

  // A hidden field and a minimum completion time reject basic automated submissions.
  if (clean(body.website, 200)) return json(200, { ok: true }, origin);
  const elapsed = Date.now() - Number(body.formStartedAt);
  if (!Number.isFinite(elapsed) || elapsed < 5_000 || elapsed > 86_400_000) return json(400, { error: "Please reload the form and try again." }, origin);

  const fullName = clean(body.fullName, 100);
  const schoolEmail = clean(body.schoolEmail, 254).toLowerCase();
  const school = clean(body.school, 150);
  const major = clean(body.major, 120);
  const graduationYear = Number(body.graduationYear);
  const experienceLevel = clean(body.experienceLevel, 20);
  const desiredRoles = uniqueAllowedRoles(body.desiredRoles);
  const projectInterests = clean(body.projectInterests, 1000);
  const teamStatus = clean(body.teamStatus, 20);
  const proposedTeamName = optional(body.proposedTeamName, 80);
  const rolesNeeded = uniqueAllowedRoles(body.rolesNeeded);
  const teamLookup = optional(body.teamLookup, 80);

  const invalid = fullName.length < 2 || !isEmail(schoolEmail) || school.length < 2 || !major ||
    !Number.isInteger(graduationYear) || graduationYear < 2026 || graduationYear > 2035 ||
    !allowedExperience.includes(experienceLevel) || !desiredRoles.length || projectInterests.length < 10 ||
    !allowedTeamStatus.includes(teamStatus) || body.agreeToRules !== true || body.confirmAccurate !== true ||
    (teamStatus === "creating" && (!proposedTeamName || !rolesNeeded.length)) ||
    (teamStatus === "joining" && !teamLookup);
  if (invalid) return json(422, { error: "Check the required fields and try again." }, origin);

  const portfolioUrl = optional(body.portfolioUrl, 500);
  if (portfolioUrl) {
    try { if (new URL(portfolioUrl).protocol !== "https:") throw new Error(); }
    catch { return json(422, { error: "Portfolio URL must be a valid HTTPS address." }, origin); }
  }

  const source = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || secretKeys.default;
  if (!secretKey) return json(503, { error: "Applications are temporarily unavailable." }, origin);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sourceHash = await hashSource(source);
  const { data: allowed, error: rateError } = await supabase.rpc("consume_application_rate_limit", { request_source_hash: sourceHash });
  if (rateError) return json(503, { error: "Applications are temporarily unavailable." }, origin);
  if (!allowed) return json(429, { error: "Too many attempts. Please try again in an hour." }, origin);

  const now = new Date().toISOString();
  const { error } = await supabase.from("applications").insert({
    full_name: fullName, school_email: schoolEmail, school, major, graduation_year: graduationYear,
    experience_level: experienceLevel, desired_roles: desiredRoles, project_interests: projectInterests,
    team_status: teamStatus, student_organization: clean(body.studentOrganization, 150) || "None",
    proposed_team_name: teamStatus === "creating" ? proposedTeamName : null,
    roles_needed: teamStatus === "creating" ? rolesNeeded : [], team_lookup: teamStatus === "joining" ? teamLookup : null,
    phone: optional(body.phone, 30), pronouns: optional(body.pronouns, 50),
    dietary_restrictions: optional(body.dietaryRestrictions, 500),
    accessibility_accommodations: optional(body.accessibilityAccommodations, 1000), portfolio_url: portfolioUrl,
    public_board_consent: body.publicBoardConsent === true, marketing_consent: body.marketingConsent === true,
    agreed_to_rules_at: now, confirmed_accurate_at: now,
  });
  if (error?.code === "23505") return json(409, { error: "An application already exists for this email address." }, origin);
  if (error) return json(503, { error: "We could not save your application. Please try again." }, origin);
  return json(201, { ok: true }, origin);
});
