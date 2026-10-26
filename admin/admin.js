"use strict";

const config = window.SUPABASE_CONFIG;
const authUrl = `${config.url}/auth/v1`;
const adminUrl = `${config.url}/functions/v1/organizer-admin`;
const sessionKey = "code-clash-organizer-session";
const roles = ["Builder", "Defender", "Analyst", "Designer", "Strategist"];
const state = {
  session: null, teams: [], applications: [], page: 1, pageSize: 10, count: 0, search: "", status: "",
  accommodations: [], accommodationPage: 1, accommodationPageSize: 25, accommodationCount: 0, accommodationSearch: "",
};

const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const globalStatus = document.querySelector("#global-status");
const applicationsBody = document.querySelector("#applications-body");
const accommodationsBody = document.querySelector("#accommodations-body");
const applicationDialog = document.querySelector("#application-dialog");
const teamDialog = document.querySelector("#team-dialog");
const reviewForm = document.querySelector("#review-form");
const teamForm = document.querySelector("#team-form");
const assignmentForm = document.querySelector("#assignment-form");
const membershipForm = document.querySelector("#membership-form");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setStatus(target, message = "", error = false) {
  target.textContent = message;
  target.classList.toggle("is-error", error);
}

function setBusy(button, busy, busyText = "Working…") {
  if (!button) return;
  if (busy) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText || button.textContent;
}

function storeSession(session) {
  state.session = session;
  if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
  else localStorage.removeItem(sessionKey);
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); }
  catch { localStorage.removeItem(sessionKey); return null; }
}

async function authRequest(path, body, token) {
  const response = await fetch(`${authUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.msg || result.error_description || result.message || "Authentication failed.");
  return result;
}

async function refreshSession() {
  if (!state.session?.refresh_token) throw new Error("Your session has expired.");
  const refreshed = await authRequest("/token?grant_type=refresh_token", { refresh_token: state.session.refresh_token });
  storeSession(refreshed);
  return refreshed;
}

async function validAccessToken() {
  if (!state.session) throw new Error("Sign in is required.");
  const expiresAt = Number(state.session.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt < Date.now() + 60_000) await refreshSession();
  return state.session.access_token;
}

async function adminRequest(action, payload = {}, retry = true) {
  const token = await validAccessToken();
  const response = await fetch(adminUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (response.status === 401 && retry) {
    await refreshSession();
    return adminRequest(action, payload, false);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "The organizer request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showLogin(message = "", error = false) {
  dashboardView.hidden = true;
  loginView.hidden = false;
  setStatus(loginStatus, message, error);
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
}

function metric(label, value) {
  const card = element("article", "metric-card");
  card.append(element("strong", "", value), element("span", "", label));
  return card;
}

function renderOverview(counts) {
  const grid = document.querySelector("#metric-grid");
  grid.replaceChildren(
    metric("Total", counts.total), metric("Submitted", counts.submitted), metric("Approved", counts.approved),
    metric("Waitlisted", counts.waitlisted), metric("Rejected", counts.rejected),
  );
  const published = state.teams.filter((team) => team.publication_status === "published").length;
  document.querySelector("#team-summary").textContent = `${state.teams.length} team${state.teams.length === 1 ? "" : "s"}, ${published} live.`;
}

function statusPill(status) {
  return element("span", `status-pill status-${status}`, status);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderApplications() {
  applicationsBody.replaceChildren();
  document.querySelector("#applications-empty").hidden = state.applications.length > 0;
  state.applications.forEach((application) => {
    const row = document.createElement("tr");
    const applicant = document.createElement("td");
    applicant.append(element("strong", "", application.full_name), element("small", "", application.school_email));
    const school = document.createElement("td");
    school.append(element("strong", "", application.school), element("small", "", `${application.major} · ${application.graduation_year}`));
    const roleCell = element("td", "", (application.desired_roles || []).join(", ") || "—");
    const date = element("td", "", formatDate(application.created_at));
    const status = document.createElement("td"); status.append(statusPill(application.application_status));
    const action = document.createElement("td");
    const view = element("button", "row-button", "Review"); view.type = "button"; view.dataset.applicationId = application.id; action.append(view);
    row.append(applicant, school, roleCell, date, status, action);
    applicationsBody.append(row);
  });
  const pages = Math.max(1, Math.ceil(state.count / state.pageSize));
  document.querySelector("#page-label").textContent = `Page ${state.page} of ${pages}`;
  document.querySelector("#previous-page").disabled = state.page <= 1;
  document.querySelector("#next-page").disabled = state.page >= pages;
}

async function loadApplications() {
  setStatus(globalStatus, "Loading applications…");
  try {
    const result = await adminRequest("listApplications", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status });
    state.applications = result.applications;
    state.count = result.count;
    renderApplications();
    setStatus(globalStatus);
  } catch (error) { handleRequestError(error); }
}

function renderAccommodations() {
  accommodationsBody.replaceChildren();
  document.querySelector("#accommodations-empty").hidden = state.accommodations.length > 0;
  state.accommodations.forEach((accommodation) => {
    const row = document.createElement("tr");
    const participant = document.createElement("td");
    participant.append(
      element("strong", "", accommodation.full_name),
      element("small", "", accommodation.school_email),
      element("small", "privacy-note", accommodation.school || "School not provided"),
    );
    const request = element("td", "accommodation-request", accommodation.accessibility_accommodations);
    const submitted = element("td", "", formatDate(accommodation.created_at));
    const status = document.createElement("td"); status.append(statusPill(accommodation.application_status));
    const actions = element("td", "accommodation-actions");
    const pdf = element("button", "row-button", "Export PDF");
    pdf.type = "button"; pdf.dataset.accommodationPdf = accommodation.id;
    const review = element("button", "row-button", "View application");
    review.type = "button"; review.dataset.accommodationApplication = accommodation.id;
    actions.append(pdf, review);
    row.append(participant, request, submitted, status, actions);
    accommodationsBody.append(row);
  });
  const pages = Math.max(1, Math.ceil(state.accommodationCount / state.accommodationPageSize));
  document.querySelector("#accommodations-page-label").textContent = `Page ${state.accommodationPage} of ${pages} · ${state.accommodationCount} request${state.accommodationCount === 1 ? "" : "s"}`;
  document.querySelector("#accommodations-previous").disabled = state.accommodationPage <= 1;
  document.querySelector("#accommodations-next").disabled = state.accommodationPage >= pages;
}

async function loadAccommodations() {
  setStatus(globalStatus, "Loading accommodation requests…");
  try {
    const result = await adminRequest("listAccommodations", {
      page: state.accommodationPage, pageSize: state.accommodationPageSize, search: state.accommodationSearch,
    });
    state.accommodations = result.accommodations;
    state.accommodationCount = result.count;
    renderAccommodations();
    setStatus(globalStatus);
  } catch (error) { handleRequestError(error); }
}

const detailLabels = {
  created_at: "Submitted", full_name: "Full name", school_email: "School email", school: "College or university",
  major: "Major / program", graduation_year: "Graduation year", experience_level: "Experience level",
  desired_roles: "Desired roles", project_interests: "Project interests", team_status: "Team status",
  student_organization_original: "Original organization response", student_organization: "Current club assignment",
  proposed_team_name: "Proposed team", roles_needed: "Roles needed",
  team_lookup: "Team lookup", phone: "Phone", pronouns: "Pronouns", dietary_restrictions: "Dietary restrictions",
  accessibility_accommodations: "Accessibility accommodations", portfolio_url: "Portfolio URL",
  public_board_consent: "Public board consent", marketing_consent: "Marketing consent", reviewed_at: "Reviewed",
  organizer_team_invite_code: "Team invite code (private)", qualifying_submission: "Qualifying project submission",
};
const wideDetails = new Set(["project_interests", "dietary_restrictions", "accessibility_accommodations"]);

function detailValue(key, value) {
  if (key.endsWith("_at")) return formatDate(value);
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value || "—";
}

async function openApplication(id) {
  setStatus(globalStatus, "Opening application…");
  try {
    const { application, clubs, clubId, joinRequest, membership, membershipChanges } = await adminRequest("applicationDetail", { id });
    if (membership || (application.team_status === "solo" && !joinRequest)) {
      const fresh = await adminRequest("bootstrap");
      state.teams = fresh.teams;
      renderOverview(fresh.counts); renderTeams();
    }
    document.querySelector("#application-dialog-title").textContent = application.full_name;
    const details = document.querySelector("#application-details"); details.replaceChildren();
    Object.entries(detailLabels).forEach(([key, label]) => {
      if (key === "organizer_team_invite_code" && application.team_status !== "creating") return;
      const item = element("dl", `detail-item${wideDetails.has(key) ? " wide" : ""}`);
      item.append(element("dt", "", label), element("dd", "", detailValue(key, application[key])));
      details.append(item);
    });
    reviewForm.elements.id.value = application.id;
    reviewForm.elements.status.value = application.application_status;
    const organizationSelect = reviewForm.elements.studentOrganizationId;
    const organizationOptions = [];
    const hasSelectableCurrentClub = (clubs || []).some((club) => club.id === clubId);
    if (!hasSelectableCurrentClub && application.student_organization && application.student_organization !== "None") {
      const keepCurrent = element("option", "", `Keep current: ${application.student_organization}`);
      keepCurrent.value = "unchanged";
      organizationOptions.push(keepCurrent);
    }
    const noAffiliation = element("option", "", "None / not affiliated");
    noAffiliation.value = "";
    organizationOptions.push(noAffiliation, ...(clubs || []).map((club) => {
      const option = element("option", "", club.name);
      option.value = club.id;
      return option;
    }));
    organizationSelect.replaceChildren(...organizationOptions);
    organizationSelect.value = hasSelectableCurrentClub ? clubId : (organizationOptions[0]?.value === "unchanged" ? "unchanged" : "");
    reviewForm.elements.qualifyingSubmission.checked = application.qualifying_submission === true;
    reviewForm.elements.notes.value = application.organizer_notes || "";
    renderJoinRequest(joinRequest);
    renderAssignment(application, joinRequest);
    renderMembership(application, membership, membershipChanges || []);
    applicationDialog.showModal();
    setStatus(globalStatus);
  } catch (error) { handleRequestError(error); }
}

function renderAssignment(application, joinRequest) {
  assignmentForm.reset();
  assignmentForm.hidden = application.team_status !== "solo" || Boolean(joinRequest);
  setStatus(document.querySelector("#assignment-status"));
  if (assignmentForm.hidden) return;
  assignmentForm.elements.id.value = application.id;
  const available = state.teams.filter((team) => team.publication_status !== "archived" && team.available_slots > 0);
  const placeholder = element("option", "", available.length ? "Select a team" : "No teams have available slots");
  placeholder.value = "";
  assignmentForm.elements.teamId.replaceChildren(placeholder, ...available.map((team) => {
    const option = element("option", "", `${team.team_name} (${team.available_slots} available, ${team.publication_status})`);
    option.value = team.id; return option;
  }));
  assignmentForm.elements.role.replaceChildren(...roles.map((role) => {
    const option = element("option", "", role); option.value = role; return option;
  }));
  assignmentForm.elements.role.value = application.desired_roles?.[0] || roles[0];
  const approved = application.application_status === "approved";
  assignmentForm.querySelector('button[type="submit"]').disabled = !approved || !available.length;
  document.querySelector("#assignment-help").textContent = !approved
    ? "Save an approved decision, then reopen this application to assign a team."
    : "Available slots exclude active invite reservations. Names appear publicly only with public-board consent.";
}

function renderMembership(application, membership, changes) {
  membershipForm.reset();
  membershipForm.hidden = !membership;
  setStatus(document.querySelector("#membership-status"));
  document.querySelector("#membership-history").hidden = !changes.length;
  document.querySelector("#membership-history-list").replaceChildren(...changes.map((change) =>
    element("li", "", `${change.from_team_name} (${change.from_role}) → ${change.to_team_name ? `${change.to_team_name} (${change.to_role})` : "Solo"} — ${change.reviewed_by}, ${formatDate(change.created_at)}`)));
  if (!membership) return;
  membershipForm.elements.id.value = application.id;
  membershipForm.elements.expectedTeamId.value = membership.teamId;
  document.querySelector("#membership-current").textContent = `Current team: ${membership.team.team_name} · ${membership.role}${membership.isCreator ? " · Team creator" : ""}`;
  const placeholder = element("option", "", "Select a destination"); placeholder.value = "";
  const solo = element("option", "", "Solo (leave current team)"); solo.value = "solo";
  const available = state.teams.filter((team) => team.id !== membership.teamId && team.publication_status !== "archived" && team.available_slots > 0);
  membershipForm.elements.teamId.replaceChildren(placeholder, solo, ...available.map((team) => {
    const option = element("option", "", `${team.team_name} (${team.available_slots} available, ${team.publication_status})`);
    option.value = team.id; return option;
  }));
  membershipForm.elements.role.replaceChildren(...roles.map((role) => {
    const option = element("option", "", role); option.value = role; return option;
  }));
  membershipForm.elements.role.value = membership.role;
  membershipForm.dataset.isCreator = String(membership.isCreator);
  document.querySelector("#membership-help").textContent = "Moving releases the current team slot. Available slots exclude active reservations."
    + (membership.isCreator ? " Leaving also revokes this creator's old team invite code." : "");
  updateMembershipRole();
}

function updateMembershipRole() {
  const solo = membershipForm.elements.teamId.value === "solo";
  membershipForm.elements.role.disabled = solo;
  document.querySelector("#membership-role-label").hidden = solo;
}

function renderJoinRequest(joinRequest) {
  const panel = document.querySelector("#join-review");
  panel.hidden = !joinRequest;
  if (!joinRequest) return;
  document.querySelector("#join-request-id").value = joinRequest.id;
  const assigned = joinRequest.source === "organizer";
  document.querySelector("#join-review-title").textContent = assigned ? "Assigned by organizer" : `${joinRequest.status} join request`;
  const team = joinRequest.team || {};
  const details = document.querySelector("#join-request-details");
  details.replaceChildren();
  const fields = [["Team", team.team_name || "Unavailable"], ["Role", joinRequest.desired_role], ["Status", joinRequest.status], ["Team capacity", team.capacity ? `${team.occupied_slots}/${team.capacity}` : "—"]];
  if (assigned) fields.push(["Assigned by", joinRequest.organizer_reviewed_by], ["Assigned", formatDate(joinRequest.organizer_reviewed_at)]);
  else fields.push(["Reserved", formatDate(joinRequest.reserved_at)], ["Expires", formatDate(joinRequest.expires_at)]);
  fields.forEach(([label, value]) => {
    const item = element("dl", "detail-item"); item.append(element("dt", "", label), element("dd", "", value)); details.append(item);
  });
  document.querySelector("#join-request-actions").hidden = joinRequest.status !== "pending";
}

function teamCard(team) {
  const card = element("article", "team-card");
  const header = document.createElement("header");
  header.append(element("h2", "", team.team_name), statusPill(team.publication_status));
  const details = document.createElement("dl");
  const publicRoster = (team.member_first_names || []).map((name, index) => `${name} · ${team.member_roles[index]}`).join(", ") || "None";
  [["Members", `${team.occupied_slots}/${team.capacity}`], ["Public roster", publicRoster], ["Seeking", (team.roles_needed || []).join(", ") || "None"], ["Updated", formatDate(team.updated_at)]].forEach(([term, value]) => details.append(element("dt", "", term), element("dd", "", value)));
  const actions = element("div", "card-actions");
  const edit = element("button", "row-button", "Edit"); edit.type = "button"; edit.dataset.teamAction = "edit"; edit.dataset.teamId = team.id; actions.append(edit);
  const publicationAction = team.publication_status === "published" ? "archive" : "publish";
  const publication = element("button", "row-button", publicationAction); publication.type = "button"; publication.dataset.teamAction = publicationAction; publication.dataset.teamId = team.id; actions.append(publication);
  const remove = element("button", "row-button danger-button", "Delete"); remove.type = "button"; remove.dataset.teamAction = "delete"; remove.dataset.teamId = team.id; actions.append(remove);
  card.append(header, details, actions);
  return card;
}

function renderTeams() {
  const list = document.querySelector("#team-list");
  list.replaceChildren(...state.teams.map(teamCard));
  document.querySelector("#teams-empty").hidden = state.teams.length > 0;
}

function memberRow(name = "", role = "Builder") {
  const row = element("div", "member-row");
  const nameLabel = element("label", "", "First name"); const nameInput = document.createElement("input"); nameInput.maxLength = 50; nameInput.value = name; nameInput.dataset.memberName = ""; nameLabel.append(nameInput);
  const roleLabel = element("label", "", "Role"); const select = document.createElement("select"); select.dataset.memberRole = ""; roles.forEach((item) => { const option = element("option", "", item); option.value = item; select.append(option); }); select.value = role; roleLabel.append(select);
  const remove = element("button", "", "Remove"); remove.type = "button"; remove.dataset.removeMember = "";
  row.append(nameLabel, roleLabel, remove);
  return row;
}

async function openTeam(team = null) {
  teamForm.reset();
  teamForm.elements.id.value = team?.id || "";
  teamForm.elements.teamName.value = team?.team_name || "";
  teamForm.elements.projectInterests.value = team?.approved_project_interests || "";
  teamForm.elements.capacity.value = team?.capacity || 4;
  teamForm.elements.occupiedSlots.value = team?.occupied_slots || 0;
  teamForm.elements.displayOrder.value = team?.display_order || 0;
  document.querySelector("#team-dialog-title").textContent = team ? "Edit team" : "Create team";
  const editor = document.querySelector("#member-editor"); editor.replaceChildren();
  (team?.member_first_names || []).forEach((name, index) => editor.append(memberRow(name, team.member_roles[index])));
  document.querySelectorAll('#roles-needed input[type="checkbox"]').forEach((box) => { box.checked = Boolean(team?.roles_needed?.includes(box.value)); });
  const registeredFieldset = document.querySelector("#registered-members-fieldset");
  const registeredList = document.querySelector("#registered-member-list");
  registeredFieldset.hidden = !team;
  registeredList.replaceChildren();
  if (team) registeredList.append(element("p", "field-help", "Loading registered participants…"));
  teamDialog.showModal();
  if (!team) return;
  try {
    const { members } = await adminRequest("teamMembers", { id: team.id });
    if (teamForm.elements.id.value !== team.id) return;
    registeredList.replaceChildren(...members.map((member) => {
      const row = element("div", "registered-member");
      const identity = document.createElement("div");
      identity.append(element("strong", "", member.full_name), element("small", "", `${member.role} · ${member.school_email}${member.is_creator ? " · Team creator" : ""}${member.public_board_consent ? " · Public display approved" : " · Keep private"}`));
      const manage = element("button", "row-button", "Manage");
      manage.type = "button"; manage.dataset.manageApplication = member.id;
      row.append(identity, manage);
      return row;
    }));
    if (!members.length) registeredList.append(element("p", "field-help", "No registered applications are assigned to this team yet."));
  } catch (error) {
    registeredList.replaceChildren(element("p", "form-status is-error", error.message));
  }
}

function teamPayload() {
  const members = [...document.querySelectorAll(".member-row")].map((row) => ({
    name: row.querySelector("[data-member-name]").value.trim(),
    role: row.querySelector("[data-member-role]").value,
  })).filter((member) => member.name);
  return {
    id: teamForm.elements.id.value || undefined,
    teamName: teamForm.elements.teamName.value,
    projectInterests: teamForm.elements.projectInterests.value,
    capacity: Number(teamForm.elements.capacity.value), occupiedSlots: Number(teamForm.elements.occupiedSlots.value), displayOrder: Number(teamForm.elements.displayOrder.value),
    memberFirstNames: members.map((member) => member.name),
    memberRoles: members.map((member) => member.role),
    rolesNeeded: [...document.querySelectorAll('#roles-needed input[type="checkbox"]:checked')].map((box) => box.value),
  };
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join(" | ") : value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportCsv(button) {
  setBusy(button, true, "Preparing…");
  try {
    const { applications } = await adminRequest("exportApplications");
    if (!applications.length) throw new Error("There are no applications to export.");
    const headers = Object.keys(applications[0]);
    const csv = [headers.map(csvCell).join(","), ...applications.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `code-clash-applications-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
    setStatus(globalStatus, `${applications.length} applications exported.`);
  } catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
}

function pdfSafeText(value) {
  return String(value || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\n]/g, "?");
}

function wrapPdfText(value, width = 82) {
  const lines = [];
  pdfSafeText(value).split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); return; }
    let line = "";
    words.forEach((word) => {
      while (word.length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, width)); word = word.slice(width);
      }
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function pdfEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function makeAccommodationPdf(accommodation) {
  const submitted = accommodation.created_at ? new Date(accommodation.created_at).toLocaleString() : "Not available";
  const documentLines = [
    "CODE / CLASH - ACCOMMODATION REQUEST",
    "CONFIDENTIAL - ORGANIZER USE ONLY",
    "",
    `Participant: ${accommodation.full_name}`,
    `Email: ${accommodation.school_email}`,
    `School: ${accommodation.school || "Not provided"}`,
    `Application status: ${accommodation.application_status}`,
    `Submitted: ${submitted}`,
    "",
    "REQUESTED ACCOMMODATIONS",
    ...wrapPdfText(accommodation.accessibility_accommodations),
    "",
    `Exported: ${new Date().toLocaleString()}`,
    "Handle and share this document only as needed to coordinate participant access.",
  ].map(pdfSafeText);
  const pageChunks = [];
  for (let index = 0; index < documentLines.length; index += 46) pageChunks.push(documentLines.slice(index, index + 46));
  const objects = [];
  const pageReferences = pageChunks.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageChunks.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageChunks.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 11 Tf", "14 TL"];
    lines.forEach((line, lineIndex) => {
      const y = 738 - lineIndex * 14;
      const size = index === 0 && lineIndex === 0 ? 16 : (index === 0 && lineIndex === 1 ? 9 : 11);
      commands.push(`/F1 ${size} Tf`, `1 0 0 1 54 ${y} Tm`, `(${pdfEscape(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportAccommodationPdf(accommodation, button) {
  setBusy(button, true, "Preparing…");
  try {
    const url = URL.createObjectURL(makeAccommodationPdf(accommodation));
    const filename = pdfSafeText(accommodation.full_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "participant";
    const link = document.createElement("a");
    link.href = url;
    link.download = `code-clash-accommodation-${filename}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(globalStatus, `Accommodation PDF exported for ${accommodation.full_name}.`);
  } catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
}

function switchView(view) {
  document.querySelectorAll("[data-panel]").forEach((panel) => { const active = panel.dataset.panel === view; panel.hidden = !active; panel.classList.toggle("is-active", active); });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  const titles = { overview: ["Command center", "Overview"], applications: ["Participant files", "Applications"], accommodations: ["Access planning", "Accommodations"], teams: ["Assembly control", "Teams"] };
  document.querySelector("#view-eyebrow").textContent = titles[view][0]; document.querySelector("#view-title").textContent = titles[view][1];
  if (view === "applications") loadApplications();
  if (view === "accommodations") loadAccommodations();
  history.replaceState(null, "", `#${view}`);
}

async function bootstrap() {
  setStatus(loginStatus, "Verifying organizer access…");
  try {
    const result = await adminRequest("bootstrap");
    state.teams = result.teams;
    document.querySelector("#organizer-email").textContent = result.organizer.email;
    renderOverview(result.counts); renderTeams();
    showDashboard();
    switchView(["overview", "applications", "accommodations", "teams"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
    setStatus(loginStatus);
  } catch (error) {
    storeSession(null);
    showLogin(error.message, true);
  }
}

function handleRequestError(error) {
  if (error.status === 401 || error.status === 403) { storeSession(null); showLogin(error.message, true); return; }
  setStatus(globalStatus, error.message || "Something went wrong.", true);
}

roles.forEach((role) => { const label = document.createElement("label"); const box = document.createElement("input"); box.type = "checkbox"; box.value = role; label.append(box, document.createTextNode(role)); document.querySelector("#roles-needed").append(label); });

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = loginForm.querySelector('button[type="submit"]'); setBusy(button, true, "Signing in…"); setStatus(loginStatus);
  try { storeSession(await authRequest("/token?grant_type=password", { email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value })); loginForm.reset(); await bootstrap(); }
  catch (error) { storeSession(null); setStatus(loginStatus, error.message, true); }
  finally { setBusy(button, false); }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  const token = state.session?.access_token; storeSession(null); showLogin("Signed out.");
  if (token) authRequest("/logout", null, token).catch(() => {});
});
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close()));

let searchTimer;
document.querySelector("#application-search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value.trim(); state.page = 1; loadApplications(); }, 300); });
document.querySelector("#application-filter").addEventListener("change", (event) => { state.status = event.target.value; state.page = 1; loadApplications(); });
document.querySelector("#previous-page").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; loadApplications(); } });
document.querySelector("#next-page").addEventListener("click", () => { if (state.page * state.pageSize < state.count) { state.page += 1; loadApplications(); } });
applicationsBody.addEventListener("click", (event) => { const button = event.target.closest("[data-application-id]"); if (button) openApplication(button.dataset.applicationId); });

let accommodationSearchTimer;
document.querySelector("#accommodation-search").addEventListener("input", (event) => {
  clearTimeout(accommodationSearchTimer);
  accommodationSearchTimer = setTimeout(() => {
    state.accommodationSearch = event.target.value.trim();
    state.accommodationPage = 1;
    loadAccommodations();
  }, 300);
});
document.querySelector("#accommodations-previous").addEventListener("click", () => {
  if (state.accommodationPage > 1) { state.accommodationPage -= 1; loadAccommodations(); }
});
document.querySelector("#accommodations-next").addEventListener("click", () => {
  if (state.accommodationPage * state.accommodationPageSize < state.accommodationCount) { state.accommodationPage += 1; loadAccommodations(); }
});
accommodationsBody.addEventListener("click", (event) => {
  const pdfButton = event.target.closest("[data-accommodation-pdf]");
  if (pdfButton) {
    const accommodation = state.accommodations.find((item) => item.id === pdfButton.dataset.accommodationPdf);
    if (accommodation) exportAccommodationPdf(accommodation, pdfButton);
    return;
  }
  const applicationButton = event.target.closest("[data-accommodation-application]");
  if (applicationButton) openApplication(applicationButton.dataset.accommodationApplication);
});

assignmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const team = state.teams.find((item) => item.id === assignmentForm.elements.teamId.value);
  if (!team) return;
  const applicant = document.querySelector("#application-dialog-title").textContent;
  const role = assignmentForm.elements.role.value;
  if (!confirm(`Assign ${applicant} to ${team.team_name} as ${role}? This uses one team slot. Confirm the participant and team agree.`)) return;
  const button = assignmentForm.querySelector('button[type="submit"]');
  setBusy(button, true, "Assigning…");
  setStatus(document.querySelector("#assignment-status"));
  try {
    const result = await adminRequest("assignSoloToTeam", { id: assignmentForm.elements.id.value, teamId: team.id, role });
    applicationDialog.close();
    await loadApplications();
    const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
    setStatus(globalStatus, result.message);
  } catch (error) {
    setStatus(document.querySelector("#assignment-status"), error.message, true);
    if (error.status === 401 || error.status === 403) { applicationDialog.close(); handleRequestError(error); }
  } finally { setBusy(button, false); }
});

membershipForm.elements.teamId.addEventListener("change", updateMembershipRole);
membershipForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const solo = membershipForm.elements.teamId.value === "solo";
  const team = state.teams.find((item) => item.id === membershipForm.elements.teamId.value);
  if (!solo && !team) return;
  const applicant = document.querySelector("#application-dialog-title").textContent;
  const role = membershipForm.elements.role.value;
  const creatorWarning = membershipForm.dataset.isCreator === "true" ? " Their old team invite code will be revoked." : "";
  if (!confirm(`${solo ? `Return ${applicant} to solo` : `Move ${applicant} to ${team.team_name} as ${role}`}? This releases their current team slot.${creatorWarning}`)) return;
  const button = membershipForm.querySelector('button[type="submit"]');
  setBusy(button, true, "Saving…");
  setStatus(document.querySelector("#membership-status"));
  try {
    const result = await adminRequest("moveTeamMember", {
      id: membershipForm.elements.id.value, expectedTeamId: membershipForm.elements.expectedTeamId.value,
      teamId: solo ? null : team.id, role: solo ? null : role,
    });
    applicationDialog.close();
    await loadApplications();
    const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
    setStatus(globalStatus, result.message);
  } catch (error) {
    setStatus(document.querySelector("#membership-status"), error.message, true);
    if (error.status === 401 || error.status === 403) { applicationDialog.close(); handleRequestError(error); }
  } finally { setBusy(button, false); }
});

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = reviewForm.querySelector('button[type="submit"]'); setBusy(button, true, "Saving…");
  try {
    const result = await adminRequest("updateApplication", { id: reviewForm.elements.id.value, status: reviewForm.elements.status.value, studentOrganizationId: reviewForm.elements.studentOrganizationId.value, qualifyingSubmission: reviewForm.elements.qualifyingSubmission.checked, notes: reviewForm.elements.notes.value });
    applicationDialog.close();
    const inviteMessage = result.inviteCode ? ` Invite code: ${result.inviteCode}` : "";
    const successMessage = `${result.message}${inviteMessage}`;
    await loadApplications(); const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
    setStatus(globalStatus, successMessage);
  }
  catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
});

document.querySelector("#delete-application").addEventListener("click", async (event) => {
  const id = reviewForm.elements.id.value;
  const applicant = document.querySelector("#application-dialog-title").textContent;
  if (!confirm(`Delete the application for ${applicant}? Associated invite and join-request records will also be removed. This cannot be undone.`)) return;
  const button = event.currentTarget; setBusy(button, true, "Deleting…");
  try {
    const result = await adminRequest("deleteApplication", { id, confirmation: "DELETE" });
    applicationDialog.close(); state.page = 1;
    await loadApplications(); const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
    setStatus(globalStatus, result.message);
  } catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
});

async function reviewJoinRequest(decision, button) {
  const requestId = document.querySelector("#join-request-id").value;
  const applicant = document.querySelector("#application-dialog-title").textContent;
  const verb = decision === "approve" ? "add" : "reject";
  if (!confirm(`${verb === "add" ? "Add" : "Reject"} ${applicant}${verb === "add" ? " to the requested team" : "’s team join request"}?`)) return;
  setBusy(button, true, decision === "approve" ? "Adding…" : "Rejecting…");
  try {
    const result = await adminRequest(decision === "approve" ? "approveJoinRequest" : "rejectJoinRequest", { requestId });
    applicationDialog.close();
    await loadApplications(); const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
    setStatus(globalStatus, result.message);
  } catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
}

document.querySelector("#approve-join-request").addEventListener("click", (event) => reviewJoinRequest("approve", event.currentTarget));
document.querySelector("#reject-join-request").addEventListener("click", (event) => reviewJoinRequest("reject", event.currentTarget));

document.querySelector("#export-csv").addEventListener("click", (event) => exportCsv(event.currentTarget));
document.querySelector("#new-team").addEventListener("click", () => openTeam());
document.querySelector("#add-member").addEventListener("click", () => document.querySelector("#member-editor").append(memberRow()));
document.querySelector("#member-editor").addEventListener("click", (event) => { if (event.target.matches("[data-remove-member]")) event.target.closest(".member-row").remove(); });
document.querySelector("#registered-member-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-manage-application]");
  if (!button) return;
  teamDialog.close();
  openApplication(button.dataset.manageApplication);
});

document.querySelector("#team-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-team-action]"); if (!button) return;
  const team = state.teams.find((item) => item.id === button.dataset.teamId); if (!team) return;
  if (button.dataset.teamAction === "edit") { openTeam(team); return; }
  const action = button.dataset.teamAction;
  if (action === "delete" && !confirm(`Delete ${team.team_name}? Its assigned applicants will return to solo status, and its invite and join-request records will be removed. This cannot be undone.`)) return;
  if (action === "publish" && !confirm(`Publish ${team.team_name} to the public website? Confirm that every displayed field is approved.`)) return;
  if (action === "archive" && !confirm(`Archive ${team.team_name} and remove it from the public website?`)) return;
  setBusy(button, true);
  try {
    const result = await adminRequest(action === "delete" ? "deleteTeam" : action === "publish" ? "publishTeam" : "archiveTeam", { id: team.id, ...(action === "delete" ? { confirmation: "DELETE" } : {}) });
    setStatus(globalStatus, result.message); const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams();
  } catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
});

teamForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = teamForm.querySelector('button[type="submit"]'); setBusy(button, true, "Saving…");
  try { const result = await adminRequest("saveTeam", teamPayload()); teamDialog.close(); setStatus(globalStatus, result.message); const fresh = await adminRequest("bootstrap"); state.teams = fresh.teams; renderOverview(fresh.counts); renderTeams(); }
  catch (error) { handleRequestError(error); }
  finally { setBusy(button, false); }
});

storeSession(loadSession());
if (state.session) bootstrap(); else showLogin();
