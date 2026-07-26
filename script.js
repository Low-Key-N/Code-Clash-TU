document.querySelector("#year").textContent = new Date().getFullYear();

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
