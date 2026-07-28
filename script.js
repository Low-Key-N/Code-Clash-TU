document.querySelector("#year").textContent = new Date().getFullYear();

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

const sceneSections = document.querySelectorAll(
  ".comic-cover, #about, #roles, #schedule, #team, #faq, #sponsors, #register",
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
