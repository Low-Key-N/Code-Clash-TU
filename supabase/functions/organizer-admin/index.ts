import { createClient } from "npm:@supabase/supabase-js@2";

const roles = ["Builder", "Defender", "Analyst", "Designer", "Strategist"] as const;
const applicationStatuses = ["submitted", "approved", "waitlisted", "rejected"] as const;
const teamStatuses = ["draft", "published", "archived"] as const;
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://codeclashtu.com,http://localhost:8000")
  .split(",").map((value) => value.trim()).filter(Boolean);

type Json = Record<string, unknown>;

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function respond(status: number, body: Json, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const allowed = <T extends readonly string[]>(value: unknown, values: T) => typeof value === "string" && values.includes(value as T[number]) ? value as T[number] : null;
const strings = (value: unknown, maxItems: number, maxLength: number) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").slice(0, maxItems).map((item) => item.trim().slice(0, maxLength)).filter(Boolean)
  : [];

function serviceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; }
  catch { return ""; }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return respond(403, { error: "Origin not allowed." }, origin);
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }});
  }
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." }, origin);
  if (!origin || !allowedOrigins.includes(origin)) return respond(403, { error: "Origin not allowed." }, origin);
  if (Number(request.headers.get("content-length") || 0) > 65_536) return respond(413, { error: "Request is too large." }, origin);

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return respond(401, { error: "Sign in is required." }, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
  const secretKey = serviceKey();
  if (!url || !publicKey || !secretKey) return respond(503, { error: "Organizer services are not configured." }, origin);

  const authClient = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return respond(401, { error: "Your session is invalid or expired." }, origin);

  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: organizer, error: organizerError } = await admin.from("organizers").select("user_id,display_name").eq("user_id", authData.user.id).maybeSingle();
  if (organizerError) {
    console.error("Organizer authorization query failed", organizerError.code);
    return respond(503, { error: "Organizer access could not be verified." }, origin);
  }
  if (!organizer) return respond(403, { error: "This account is not an approved organizer." }, origin);

  let body: Json;
  try { body = await request.json(); }
  catch { return respond(400, { error: "Invalid request body." }, origin); }
  if (JSON.stringify(body).length > 65_536) return respond(413, { error: "Request is too large." }, origin);
  const action = clean(body.action, 50);
  const normalizedAction = action.replace(/[\s_-]/g, "").toLowerCase();
  const reviewer = (authData.user.email || authData.user.id).slice(0, 120);

  try {
    if (action === "bootstrap") {
      const countFor = (status?: string) => {
        let query = admin.from("applications").select("id", { count: "exact", head: true });
        if (status) query = query.eq("application_status", status);
        return query;
      };
      const [total, submitted, approved, waitlisted, rejected, teams] = await Promise.all([
        countFor(), countFor("submitted"), countFor("approved"), countFor("waitlisted"), countFor("rejected"),
        admin.from("public_teams").select("id,team_name,member_first_names,member_roles,roles_needed,approved_project_interests,capacity,occupied_slots,publication_status,reviewed_by,published_at,display_order,updated_at").order("updated_at", { ascending: false }),
      ]);
      const countError = [total, submitted, approved, waitlisted, rejected].find((result) => result.error)?.error;
      if (countError || teams.error) throw countError || teams.error;
      return respond(200, {
        organizer: { id: authData.user.id, email: authData.user.email || "Organizer", displayName: organizer.display_name || "Organizer" },
        counts: { total: total.count || 0, submitted: submitted.count || 0, approved: approved.count || 0, waitlisted: waitlisted.count || 0, rejected: rejected.count || 0 },
        teams: teams.data || [],
      }, origin);
    }

    if (action === "listApplications") {
      const page = Math.max(1, Math.min(1000, Number(body.page) || 1));
      const pageSize = Math.max(10, Math.min(100, Number(body.pageSize) || 25));
      const status = clean(body.status, 20);
      const search = clean(body.search, 100).replace(/[^a-z0-9@._ +\-]/gi, "");
      let query = admin.from("applications")
        .select("id,created_at,full_name,school_email,school,major,graduation_year,experience_level,desired_roles,team_status,application_status,reviewed_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (allowed(status, applicationStatuses)) query = query.eq("application_status", status);
      if (search) query = query.or(`full_name.ilike.%${search}%,school_email.ilike.%${search}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return respond(200, { applications: data || [], count: count || 0, page, pageSize }, origin);
    }

    if (action === "applicationDetail") {
      const id = uuid(body.id);
      if (!id) return respond(422, { error: "A valid application ID is required." }, origin);
      const { data, error } = await admin.from("applications").select("*").eq("id", id).single();
      if (error?.code === "PGRST116") return respond(404, { error: "Application not found." }, origin);
      if (error) throw error;
      let joinRequest: Record<string, unknown> | null = null;
      if (data.team_status === "joining") {
        const { data: requestData, error: requestError } = await admin.from("team_join_requests")
          .select("id,public_team_id,desired_role,status,reserved_at,expires_at,organizer_reviewed_by,organizer_reviewed_at")
          .eq("application_id", id).maybeSingle();
        if (requestError) throw requestError;
        if (requestData) {
          const { data: teamData, error: teamError } = await admin.from("public_teams")
            .select("team_name,publication_status,capacity,occupied_slots").eq("id", requestData.public_team_id).maybeSingle();
          if (teamError) throw teamError;
          joinRequest = { ...requestData, team: teamData };
        }
      }
      return respond(200, { application: data, joinRequest }, origin);
    }

    if (action === "updateApplication") {
      const id = uuid(body.id);
      const status = allowed(body.status, applicationStatuses);
      const notes = clean(body.notes, 2000) || null;
      if (!id || !status) return respond(422, { error: "A valid application and status are required." }, origin);
      let createdTeam: Record<string, unknown> | null = null;
      let inviteCode: string | null = null;

      if (status === "approved") {
        const { data: application, error: applicationError } = await admin.from("applications")
          .select("id,full_name,desired_roles,project_interests,team_status,proposed_team_name,roles_needed,public_board_consent,organizer_team_invite_code")
          .eq("id", id).single();
        if (applicationError?.code === "PGRST116") return respond(404, { error: "Application not found." }, origin);
        if (applicationError) throw applicationError;

        if (application.team_status === "creating" && application.proposed_team_name) {
          const { data: existingInvite, error: inviteLookupError } = await admin.from("team_invites")
            .select("public_team_id").eq("owner_application_id", id).maybeSingle();
          if (inviteLookupError) throw inviteLookupError;
          if (existingInvite && !application.organizer_team_invite_code) {
            const rotatedInvite = await admin.rpc("create_team_invite", { team_id: existingInvite.public_team_id, owner_id: id });
            if (rotatedInvite.error) throw rotatedInvite.error;
            inviteCode = rotatedInvite.data;
          } else if (!existingInvite) {
            const creatorRole = Array.isArray(application.desired_roles) && application.desired_roles.length ? application.desired_roles[0] : "Builder";
            const publicName = application.public_board_consent ? clean(application.full_name, 100).split(/\s+/)[0] : "";
            const { data: team, error: teamError } = await admin.from("public_teams").insert({
              team_name: clean(application.proposed_team_name, 80),
              member_first_names: publicName ? [publicName] : [],
              member_roles: publicName ? [creatorRole] : [],
              roles_needed: Array.isArray(application.roles_needed) ? application.roles_needed : [],
              approved_project_interests: clean(application.project_interests, 300),
              capacity: 4,
              occupied_slots: 1,
              publication_status: "draft",
              updated_at: new Date().toISOString(),
            }).select("*").single();
            if (teamError) throw teamError;
            const inviteResult = await admin.rpc("create_team_invite", { team_id: team.id, owner_id: id });
            if (inviteResult.error) {
              await admin.from("public_teams").delete().eq("id", team.id);
              throw inviteResult.error;
            }
            createdTeam = team;
            inviteCode = inviteResult.data;
          }
        }
      }
      const { data, error } = await admin.from("applications").update({
        application_status: status, organizer_notes: notes, reviewed_at: new Date().toISOString(),
        reviewed_by: authData.user.id, updated_at: new Date().toISOString(),
        ...(inviteCode ? { organizer_team_invite_code: inviteCode } : {}),
      }).eq("id", id).select("id,application_status,organizer_notes,reviewed_at,updated_at").single();
      if (error?.code === "PGRST116") return respond(404, { error: "Application not found." }, origin);
      if (error) {
        if (createdTeam?.id) await admin.from("public_teams").delete().eq("id", createdTeam.id);
        throw error;
      }
      return respond(200, {
        application: data,
        ...(createdTeam ? { createdTeam } : {}),
        ...(inviteCode ? { inviteCode } : {}),
        message: createdTeam ? "Application approved and draft team created. The invite code is saved on the private application record." : inviteCode ? "Application updated and a retrievable invite code was saved." : "Application updated.",
      }, origin);
    }

    if (normalizedAction === "deleteapplication") {
      const id = uuid(body.id);
      if (!id || body.confirmation !== "DELETE") return respond(422, { error: "Explicit deletion confirmation is required." }, origin);
      const { data, error } = await admin.from("applications").delete().eq("id", id).select("id,full_name").maybeSingle();
      if (error) throw error;
      if (!data) return respond(404, { error: "Application not found." }, origin);
      return respond(200, { message: `Application for ${clean(data.full_name, 100)} deleted.` }, origin);
    }

    if (normalizedAction === "approvejoinrequest" || normalizedAction === "rejectjoinrequest") {
      const requestId = uuid(body.requestId);
      if (!requestId) return respond(422, { error: "A valid join request ID is required." }, origin);
      const result = normalizedAction === "approvejoinrequest"
        ? await admin.rpc("approve_team_join_request", { request_id: requestId, reviewer })
        : await admin.rpc("reject_team_join_request", { request_id: requestId, reviewer });
      if (result.error) throw result.error;
      return respond(200, { message: normalizedAction === "approvejoinrequest" ? "Applicant added to the team." : "Team join request rejected." }, origin);
    }

    if (action === "exportApplications") {
      const { data, error } = await admin.from("applications").select("*").order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      const exportRows = (data || []).map(({ organizer_team_invite_code: _privateInviteCode, ...application }) => application);
      return respond(200, { applications: exportRows }, origin);
    }

    if (action === "saveTeam") {
      const id = body.id ? uuid(body.id) : null;
      if (body.id && !id) return respond(422, { error: "Invalid team ID." }, origin);
      const teamName = clean(body.teamName, 80);
      const memberFirstNames = strings(body.memberFirstNames, 8, 50);
      const memberRoles = strings(body.memberRoles, 8, 20);
      const rolesNeeded = [...new Set(strings(body.rolesNeeded, 5, 20))];
      const capacity = Number(body.capacity);
      const occupiedSlots = Number(body.occupiedSlots);
      const displayOrder = Number(body.displayOrder) || 0;
      const interests = clean(body.projectInterests, 300);
      if (!teamName || memberFirstNames.length !== memberRoles.length || !memberRoles.every((role) => roles.includes(role as typeof roles[number])) ||
          !rolesNeeded.every((role) => roles.includes(role as typeof roles[number])) || !Number.isInteger(capacity) || capacity < 2 || capacity > 8 ||
          !Number.isInteger(occupiedSlots) || occupiedSlots < memberFirstNames.length || occupiedSlots > capacity || !Number.isInteger(displayOrder)) {
        return respond(422, { error: "Check the team name, members, roles, capacity, and occupied slots." }, origin);
      }
      const payload = {
        team_name: teamName, member_first_names: memberFirstNames, member_roles: memberRoles,
        roles_needed: rolesNeeded, approved_project_interests: interests, capacity,
        occupied_slots: occupiedSlots, display_order: displayOrder, updated_at: new Date().toISOString(),
      };
      const query = id ? admin.from("public_teams").update(payload).eq("id", id) : admin.from("public_teams").insert(payload);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return respond(id ? 200 : 201, { team: data, message: id ? "Team updated." : "Team created." }, origin);
    }

    if (action === "publishTeam" || action === "archiveTeam") {
      const id = uuid(body.id);
      if (!id) return respond(422, { error: "A valid team ID is required." }, origin);
      const result = action === "publishTeam"
        ? await admin.rpc("publish_public_team", { team_id: id, reviewer })
        : await admin.rpc("archive_public_team", { team_id: id });
      if (result.error) throw result.error;
      return respond(200, { message: action === "publishTeam" ? "Team published." : "Team archived." }, origin);
    }

    if (action === "deleteTeam") {
      const id = uuid(body.id);
      if (!id || body.confirmation !== "DELETE") return respond(422, { error: "Explicit deletion confirmation is required." }, origin);
      const { data, error } = await admin.from("public_teams").delete().eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return respond(404, { error: "Team not found." }, origin);
      return respond(200, { message: "Team deleted." }, origin);
    }

    // Organizer access is intentionally not mutable through this endpoint.
    if (normalizedAction.includes("organizer")) return respond(403, { error: "Organizer access cannot be changed here." }, origin);
    console.warn("Unknown organizer-admin action received", action || "(missing)");
    return respond(400, { error: `Unknown action: ${action || "(missing)"}.` }, origin);
  } catch (error) {
    console.error("organizer-admin action failed", action, error instanceof Error ? error.message : "unknown error");
    return respond(500, { error: "The organizer request could not be completed." }, origin);
  }
});
