document.querySelector("#year").textContent = new Date().getFullYear();

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo({ top: 0, left: 0, behavior: "instant" });

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (prefersReducedMotion.matches) document.body.classList.remove("site-loading");
window.addEventListener("load", () => {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  window.setTimeout(() => document.body.classList.remove("site-loading"), 1150);
}, { once: true });

const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");

function closeMenu() {
  primaryNav.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
}

menuToggle.addEventListener("click", () => {
  const willOpen = !primaryNav.classList.contains("is-open");
  primaryNav.classList.toggle("is-open", willOpen);
  menuToggle.setAttribute("aria-expanded", String(willOpen));
});

primaryNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && primaryNav.classList.contains("is-open")) {
    closeMenu();
    menuToggle.focus();
  }
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 860) closeMenu();
});

const eventStart = new Date("2026-11-13T00:00:00-05:00");
const countdown = document.querySelector(".countdown");
const countdownFields = {
  days: document.querySelector("#countdown-days"),
  hours: document.querySelector("#countdown-hours"),
  minutes: document.querySelector("#countdown-minutes"),
  seconds: document.querySelector("#countdown-seconds"),
};

function updateCountdown() {
  const remaining = eventStart.getTime() - Date.now();

  if (remaining <= 0) {
    const liveMessage = document.createElement("small");
    liveMessage.textContent = "The clash is live!";
    countdown.replaceChildren(liveMessage);
    return false;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  countdownFields.days.textContent = String(Math.floor(totalSeconds / 86400)).padStart(3, "0");
  countdownFields.hours.textContent = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, "0");
  countdownFields.minutes.textContent = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  countdownFields.seconds.textContent = String(totalSeconds % 60).padStart(2, "0");
  return true;
}

updateCountdown();
const countdownInterval = window.setInterval(() => {
  if (!updateCountdown()) {
    window.clearInterval(countdownInterval);
  }
}, 1000);

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 },
);

document.querySelectorAll(".reveal").forEach((panel) => revealObserver.observe(panel));

const assemblyTabs = [...document.querySelectorAll('[role="tab"][aria-controls$="-panel"]')];
const assemblyPanels = assemblyTabs.map((tab) => document.querySelector(`#${tab.getAttribute("aria-controls")}`));
const assemblyEyebrow = document.querySelector("#assembly-eyebrow");
const assemblyTitle = document.querySelector("#assembly-title");
const assemblyCopy = document.querySelector("#assembly-copy");

const assemblyContent = {
  "roles-tab": {
    eyebrow: "Choose your role",
    title: "Every team needs a hero.",
    copy: "You can be one, mix a few, or discover yours during the weekend.",
  },
  "teams-tab": {
    eyebrow: "Assembly queue",
    title: "The teams are assembling.",
    copy: "See who has formed up, which roles are missing, and where your skills can land.",
  },
};

function activateAssemblyTab(nextTab) {
  assemblyTabs.forEach((tab, index) => {
    const isActive = tab === nextTab;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    assemblyPanels[index].classList.toggle("is-active", isActive);
    assemblyPanels[index].setAttribute("aria-hidden", String(!isActive));
    assemblyPanels[index].inert = !isActive;
  });

  const content = assemblyContent[nextTab.id];
  assemblyEyebrow.textContent = content.eyebrow;
  assemblyTitle.textContent = content.title;
  assemblyCopy.textContent = content.copy;
}

assemblyTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateAssemblyTab(tab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % assemblyTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + assemblyTabs.length) % assemblyTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = assemblyTabs.length - 1;
    if (nextIndex !== index) {
      event.preventDefault();
      assemblyTabs[nextIndex].focus();
      activateAssemblyTab(assemblyTabs[nextIndex]);
    }
  });
});

const teamQueue = document.querySelector("#team-queue");
const assembledTeamCount = document.querySelector("#assembled-team-count");
const roleInitials = { Builder: "B", Defender: "D", Analyst: "A", Designer: "D", Strategist: "S" };

function teamBoardState(title, detail) {
  const state = document.createElement("div");
  state.className = "team-queue-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = detail;
  state.append(heading, copy);
  teamQueue.replaceChildren(state);
}

function renderPublicTeams(teams) {
  assembledTeamCount.textContent = String(teams.length).padStart(2, "0");
  if (!teams.length) {
    teamBoardState("No teams published yet.", "Organizer-approved teams will appear here once assembly begins.");
    return;
  }

  const cards = teams.map((team, index) => {
    const card = document.createElement("article");
    const members = Array.isArray(team.members) ? team.members : [];
    const capacity = Math.max(2, Math.min(8, Number(team.capacity) || 4));
    const occupiedSlots = Math.max(members.length, Math.min(capacity, Number(team.occupiedSlots) || members.length));
    const openSlots = Math.max(0, capacity - occupiedSlots);
    card.className = `queue-card${openSlots === 0 ? " queue-card-full" : ""}`;

    const top = document.createElement("div");
    top.className = "queue-card-top";
    const number = document.createElement("span");
    number.textContent = `Team ${String(index + 1).padStart(3, "0")}`;
    const occupancy = document.createElement("strong");
    occupancy.textContent = `${occupiedSlots}/${capacity}`;
    top.append(number, occupancy);

    const name = document.createElement("h3");
    name.textContent = team.teamName;
    const slots = document.createElement("div");
    slots.className = "slot-icons";
    slots.setAttribute("aria-label", `${occupiedSlots} of ${capacity} team slots filled`);
    members.forEach((member) => {
      const filled = document.createElement("b");
      filled.textContent = roleInitials[member.role] || "?";
      filled.title = `${member.firstName}: ${member.role}`;
      slots.append(filled);
    });
    for (let slot = members.length; slot < occupiedSlots; slot += 1) {
      const privateMember = document.createElement("b");
      privateMember.textContent = "•";
      privateMember.title = "Private team member";
      slots.append(privateMember);
    }
    for (let slot = occupiedSlots; slot < capacity; slot += 1) {
      const open = document.createElement("i");
      open.textContent = "+";
      slots.append(open);
    }

    const memberList = document.createElement("p");
    memberList.className = "queue-members";
    memberList.textContent = members.map((member) => `${member.firstName} — ${member.role}`).join(" · ") || "Team details coming soon";
    const need = document.createElement("p");
    const needText = document.createElement("strong");
    needText.textContent = team.rolesNeeded?.length ? `Seeking ${team.rolesNeeded.join(" + ")}` : "Ready to build";
    need.append(needText);
    const interests = document.createElement("small");
    interests.textContent = team.projectInterests || "Project interests coming soon";
    const availability = document.createElement("em");
    availability.textContent = openSlots ? `${openSlots} slot${openSlots === 1 ? "" : "s"} open` : "Full team";
    card.append(top, name, slots, memberList, need, interests, availability);
    return card;
  });
  teamQueue.replaceChildren(...cards);
}

async function loadPublicTeams() {
  const config = window.SUPABASE_CONFIG;
  if (!teamQueue || !assembledTeamCount || !config?.url) return;
  try {
    const response = await fetch(`${config.url}/functions/v1/list-public-teams`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.teams)) throw new Error();
    renderPublicTeams(result.teams);
  } catch {
    assembledTeamCount.textContent = "00";
    teamBoardState("Team board unavailable.", "Please check back soon.");
  } finally {
    teamQueue.setAttribute("aria-busy", "false");
  }
}

loadPublicTeams();

const sceneSections = document.querySelectorAll(
  ".comic-cover, #about, #roles, #schedule, #team, #faq, #sponsors, #community-partners, #register",
);

let sceneUpdateQueued = false;

function updateAmbientScene() {
  const focusLine = window.innerHeight * 0.38;
  let activeSection = sceneSections[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  sceneSections.forEach((section) => {
    const bounds = section.getBoundingClientRect();
    const sectionFocus = Math.max(bounds.top, Math.min(focusLine, bounds.bottom));
    const distance = Math.abs(sectionFocus - focusLine);

    if (distance < closestDistance) {
      activeSection = section;
      closestDistance = distance;
    }
  });

  const nextScene = activeSection.id || "cover";
  if (document.body.dataset.scene !== nextScene) {
    document.body.dataset.scene = nextScene;
  }

  sceneUpdateQueued = false;
}

function queueAmbientSceneUpdate() {
  if (!sceneUpdateQueued) {
    sceneUpdateQueued = true;
    window.requestAnimationFrame(updateAmbientScene);
  }
}

window.addEventListener("scroll", queueAmbientSceneUpdate, { passive: true });
window.addEventListener("resize", queueAmbientSceneUpdate);
updateAmbientScene();

const applicationForm = document.querySelector("#application-form");

if (applicationForm && window.SUPABASE_CONFIG?.registrationOpen) {
  applicationForm.hidden = false;
  const testingMode = window.SUPABASE_CONFIG.testingMode === true;
  document.querySelector("#registration-title").textContent = testingMode ? "Test the CLASH #001 application." : "Apply for CLASH #001.";
  document.querySelector("#registration-copy").textContent = testingMode
    ? "Help us test the application experience before registration officially opens."
    : "Tell us how you want to join the clash. Required fields are marked with an asterisk.";
  document.querySelector("#testing-notice").hidden = !testingMode;
  const statusMessage = document.querySelector("#application-status");
  const submitButton = applicationForm.querySelector('button[type="submit"]');
  const startedAt = applicationForm.elements.formStartedAt;
  const allowedRoles = ["Builder", "Defender", "Analyst", "Designer", "Strategist"];
  startedAt.value = String(Date.now());

  function valuesFor(name) {
    return [...applicationForm.querySelectorAll(`[name="${name}"]:checked`)].map((field) => field.value);
  }

  function updateTeamFields() {
    const teamStatus = applicationForm.elements.teamStatus.value;
    applicationForm.querySelectorAll("[data-team-status]").forEach((group) => {
      const active = group.dataset.teamStatus === teamStatus;
      group.hidden = !active;
      group.querySelectorAll("input").forEach((input) => { input.disabled = !active; });
    });
  }

  applicationForm.querySelectorAll('[name="teamStatus"]').forEach((field) => field.addEventListener("change", updateTeamFields));
  updateTeamFields();

  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusMessage.classList.remove("is-error");

    if (!applicationForm.reportValidity()) return;
    const desiredRoles = valuesFor("desiredRoles");
    const rolesNeeded = valuesFor("rolesNeeded");
    const teamStatus = applicationForm.elements.teamStatus.value;

    if (!desiredRoles.length || desiredRoles.some((role) => !allowedRoles.includes(role))) {
      statusMessage.textContent = "Choose at least one desired role.";
      statusMessage.classList.add("is-error");
      return;
    }
    if (teamStatus === "creating" && !rolesNeeded.length) {
      statusMessage.textContent = "Choose at least one role your team needs.";
      statusMessage.classList.add("is-error");
      return;
    }
    if (teamStatus === "joining" && !desiredRoles.includes(applicationForm.elements.joinRole.value)) {
      statusMessage.textContent = "Your team role must also be selected under desired roles.";
      statusMessage.classList.add("is-error");
      return;
    }

    const data = new FormData(applicationForm);
    const payload = Object.fromEntries(data.entries());
    payload.formElapsedMs = Date.now() - Number(startedAt.value);
    payload.desiredRoles = desiredRoles;
    payload.rolesNeeded = rolesNeeded;
    ["agreeToRules", "confirmAccurate", "publicBoardConsent", "marketingConsent"].forEach((name) => {
      payload[name] = data.has(name);
    });

    const config = window.SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey) {
      statusMessage.textContent = "Applications are temporarily unavailable. Please try again later.";
      statusMessage.classList.add("is-error");
      return;
    }

    submitButton.disabled = true;
    statusMessage.textContent = "Submitting…";
    try {
      const response = await fetch(`${config.url}/functions/v1/submit-application`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.publishableKey },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "We could not submit your application.");

      applicationForm.reset();
      startedAt.value = String(Date.now());
      updateTeamFields();
      statusMessage.textContent = teamStatus === "joining"
        ? "Your slot is reserved pending organizer approval."
        : testingMode
          ? "Test submission received! This is not an official event application."
          : "Application received! Check your school email for future updates.";
    } catch (error) {
      statusMessage.textContent = error.message || "We could not submit your application. Please try again.";
      statusMessage.classList.add("is-error");
    } finally {
      submitButton.disabled = false;
    }
  });
}
