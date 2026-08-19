/* ScrapMan — accounts, roles, and the live-tracking channel.
 *
 * Everything in this file is designed to no-op gracefully when Supabase isn't
 * configured (see supabase-config.js) — the app then behaves exactly as the
 * original open demo, no accounts required. Once configured, it gates the app
 * behind sign-up/sign-in and splits the experience by role.
 */

const SCRAPMAN_AUTH_CONFIGURED = !!(
  window.SCRAPMAN_SUPABASE &&
  window.SCRAPMAN_SUPABASE.url && !window.SCRAPMAN_SUPABASE.url.includes("YOUR-PROJECT") &&
  window.SCRAPMAN_SUPABASE.anonKey && !window.SCRAPMAN_SUPABASE.anonKey.includes("YOUR-ANON")
);

const scrapmanDb = SCRAPMAN_AUTH_CONFIGURED && typeof supabase !== "undefined"
  ? supabase.createClient(window.SCRAPMAN_SUPABASE.url, window.SCRAPMAN_SUPABASE.anonKey)
  : null;

/* session = { user, profile, collectorProfile } | null */
let scrapmanSession = null;

function scrapmanRole() {
  return scrapmanSession && scrapmanSession.profile ? scrapmanSession.profile.role : null;
}

function scrapmanEmitAuthChange() {
  window.dispatchEvent(new CustomEvent("scrapman:auth", { detail: { session: scrapmanSession } }));
}

async function scrapmanLoadProfile(user) {
  const { data: profile } = await scrapmanDb.from("profiles").select("*").eq("id", user.id).single();
  let collectorProfile = null;
  if (profile && profile.role === "collector") {
    const { data } = await scrapmanDb.from("collector_profiles").select("*").eq("profile_id", user.id).single();
    collectorProfile = data || null;
  }
  return { user, profile, collectorProfile };
}

async function scrapmanRefreshSession() {
  if (!scrapmanDb) return null;
  const { data: { user } } = await scrapmanDb.auth.getUser();
  scrapmanSession = user ? await scrapmanLoadProfile(user) : null;
  scrapmanEmitAuthChange();
  return scrapmanSession;
}

async function scrapmanSignUp({ email, password, role, displayName }) {
  const { data, error } = await scrapmanDb.auth.signUp({
    email, password,
    options: { data: { role, display_name: displayName } }
  });
  if (error) return { error };
  // A fresh sign-up may require email confirmation depending on your project's auth
  // settings — if so, data.session will be null here even though data.user exists.
  if (data.session) await scrapmanRefreshSession();
  return { data };
}

async function scrapmanSignIn({ email, password }) {
  const { data, error } = await scrapmanDb.auth.signInWithPassword({ email, password });
  if (error) return { error };
  await scrapmanRefreshSession();
  return { data };
}

async function scrapmanSignOut() {
  if (!scrapmanDb) return;
  await scrapmanDb.auth.signOut();
  scrapmanSession = null;
  scrapmanEmitAuthChange();
}

/* ---------- role-gated UI ---------- */
function scrapmanApplyRoleUI() {
  const role = scrapmanRole();
  // An element can carry more than one gating attribute at once (e.g. the Track tab is
  // both .needs-backend AND data-role="homeowner"). Reset first, then each rule below
  // only ever ADDS "hidden" — never removes it — so overlapping reasons to hide an
  // element can't clobber each other by racing to the last word on one shared class.
  document.querySelectorAll(".needs-backend, [data-role], [data-signed-in-only]")
    .forEach(el => el.classList.remove("hidden"));

  if (!SCRAPMAN_AUTH_CONFIGURED) {
    document.querySelectorAll(".needs-backend").forEach(el => el.classList.add("hidden"));
  }
  document.querySelectorAll("[data-role]").forEach(el => {
    const allowed = el.dataset.role.split(" ");
    if (SCRAPMAN_AUTH_CONFIGURED && role && !allowed.includes(role)) el.classList.add("hidden");
  });
  document.querySelectorAll("[data-signed-in-only]").forEach(el => {
    if (SCRAPMAN_AUTH_CONFIGURED && !scrapmanSession) el.classList.add("hidden");
  });
  const nameEls = document.querySelectorAll(".scrapman-display-name");
  nameEls.forEach(el => { el.textContent = scrapmanSession ? scrapmanSession.profile.display_name : ""; });
  const roleLabel = document.getElementById("accRoleLabel");
  if (roleLabel) roleLabel.textContent = role ? (role === "collector" ? "Collector account" : "Homeowner account") : "";
}

/* ---------- live tracking channel ----------
 * One Supabase Realtime broadcast channel per job_assignment. The collector
 * (while en route) publishes their position every ~12s; the homeowner who owns
 * that listing subscribes and gets live updates. Nothing is written to a table —
 * broadcast is ephemeral, which is all a "where are they right now" ping needs. */
let scrapmanLocationChannel = null;
let scrapmanLocationTimer = null;

function scrapmanTrackChannelName(assignmentId) {
  return `job:${assignmentId}:location`;
}

function scrapmanSubscribeToLocation(assignmentId, onLocation) {
  scrapmanUnsubscribeFromLocation();
  if (!scrapmanDb) return;
  scrapmanLocationChannel = scrapmanDb
    .channel(scrapmanTrackChannelName(assignmentId))
    .on("broadcast", { event: "position" }, ({ payload }) => onLocation(payload))
    .subscribe();
}

function scrapmanUnsubscribeFromLocation() {
  if (scrapmanLocationChannel) { scrapmanDb.removeChannel(scrapmanLocationChannel); scrapmanLocationChannel = null; }
}

/* Collector side: start/stop broadcasting this device's GPS position on the
 * given assignment's channel. Safe to call repeatedly — restarts cleanly. */
function scrapmanStartBroadcastingLocation(assignmentId) {
  scrapmanStopBroadcastingLocation();
  if (!scrapmanDb || !("geolocation" in navigator)) return;
  const channel = scrapmanDb.channel(scrapmanTrackChannelName(assignmentId));
  channel.subscribe(status => {
    if (status !== "SUBSCRIBED") return;
    const ping = () => navigator.geolocation.getCurrentPosition(pos => {
      channel.send({
        type: "broadcast",
        event: "position",
        payload: { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() }
      });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 8000 });
    ping();
    scrapmanLocationTimer = setInterval(ping, 12000);
  });
  scrapmanLocationChannel = channel;
}

function scrapmanStopBroadcastingLocation() {
  if (scrapmanLocationTimer) { clearInterval(scrapmanLocationTimer); scrapmanLocationTimer = null; }
  scrapmanUnsubscribeFromLocation();
}

/* ---------- boot ---------- */
if (scrapmanDb) {
  scrapmanDb.auth.onAuthStateChange((_event, _session) => { scrapmanRefreshSession().then(scrapmanApplyRoleUI); });
  scrapmanRefreshSession().then(scrapmanApplyRoleUI);
} else {
  // Unconfigured — nothing is hidden, app behaves as the original open demo.
  document.addEventListener("DOMContentLoaded", scrapmanApplyRoleUI);
}
