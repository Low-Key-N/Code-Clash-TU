"use strict";

// Registration sessions stay in memory; no refresh tokens or application drafts
// are retained in browser storage. The server independently verifies identity.
window.registrationAuth = (() => {
  const config = window.SUPABASE_CONFIG;
  const verificationForm = document.querySelector("#email-verification-form");
  const application = document.querySelector("#application-form");
  const status = document.querySelector("#verification-status");
  let accessToken = "";
  let verifiedEmail = "";
  let expiresAt = 0;
  let nextSendAt = 0;

  function reset(message = "") {
    accessToken = ""; verifiedEmail = ""; expiresAt = 0;
    application.hidden = true;
    application.reset();
    verificationForm.hidden = !config?.registrationOpen;
    status.textContent = message;
  }

  verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!config?.registrationOpen || !verificationForm.reportValidity()) return;
    if (Date.now() < nextSendAt) { status.textContent = "Please wait a minute before requesting another link."; return; }
    const button = verificationForm.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = "Sending verification link…";
    try {
      const redirect = `${location.origin}${location.pathname}`;
      const response = await fetch(`${config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.publishableKey },
        body: JSON.stringify({ email: verificationForm.elements.email.value.trim(), create_user: true }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many requests. Please wait before requesting another link." : "Email verification is temporarily unavailable. Please try again later.");
      nextSendAt = Date.now() + 60_000;
      status.textContent = "Check your inbox for a verification link. Open it to continue your application.";
    } catch (error) { status.textContent = error.message || "Unable to send a verification link."; }
    finally { button.disabled = false; }
  });

  document.querySelector("#change-verified-email").addEventListener("click", () => reset("Enter the school email you want to use."));

  async function completeVerification() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const returnedToken = fragment.get("access_token");
    const authError = fragment.has("error") || fragment.has("error_description");
    if (!returnedToken && !authError) return;
    // Remove the entire callback fragment, including unused refresh tokens.
    history.replaceState(null, "", `${location.pathname}${location.search}#register`);
    reset(authError ? "That link is invalid or expired. Request a fresh verification link." : "");
    if (!config?.registrationOpen || !returnedToken) return;
    try {
      const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${returnedToken}` } });
      const user = await response.json();
      if (!response.ok || !user.email || !user.email_confirmed_at || user.is_anonymous) throw new Error();
      const claims = JSON.parse(atob(returnedToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const verifiedAt = Math.max(0, ...(claims.amr || []).filter((entry) => ["otp", "magiclink"].includes(entry.method)).map((entry) => Number(entry.timestamp) || 0));
      expiresAt = Math.min(Number(claims.exp) * 1000, (verifiedAt + 3600) * 1000);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || user.phone || claims.email?.toLowerCase() !== user.email.toLowerCase()) throw new Error();
      accessToken = returnedToken; verifiedEmail = user.email.toLowerCase();
      application.elements.schoolEmail.value = verifiedEmail;
      application.elements.formStartedAt.value = String(Date.now());
      document.querySelector("#verified-email-status").textContent = `Email verified: ${verifiedEmail}`;
      verificationForm.hidden = true; application.hidden = false;
      document.querySelector("#register").scrollIntoView();
    } catch { reset("That link is invalid or expired. Request a fresh verification link."); }
  }
  reset();
  let ready = completeVerification();
  window.addEventListener("hashchange", () => { ready = completeVerification(); });

  return {
    get ready() { return ready; },
    token() {
      if (!accessToken || expiresAt <= Date.now()) { reset("Email verification expired. Request a fresh link."); return ""; }
      return accessToken;
    },
    email: () => verifiedEmail,
    reset,
  };
})();
