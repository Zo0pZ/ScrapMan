import { esc } from "../state.js";
import { openSheet, closeSheet } from "./navigation.js";

/* ---------- notifications: in-app feed, unread badge, collector alerts ----------
 *
 * Three layers, deliberately separable:
 *
 *   1. Rows in the `notifications` table (migration 006). These are durable and are the
 *      source of truth — a `new_job_nearby` row per collector per listing, a
 *      `listing_collected` row for the homeowner, a `dispute_raised` row for the other
 *      party. Written by the notify-new-listing endpoint and by SQL triggers.
 *   2. Realtime. While a tab is open, an INSERT on this user's rows updates the bell
 *      dot immediately. No polling.
 *   3. OS-level web push, which is the only layer that works when the tab is closed.
 *      That needs a VAPID key pair plus a sender, so it stays off until
 *      window.SCRAPMAN_VAPID_PUBLIC_KEY exists; the feed and the badge work regardless.
 *      Nothing here pretends push is live when it isn't.
 */

let realtimeChannel = null;
let unread = 0;

const KIND_COPY = {
  new_job_nearby: { icon: "📍", title: "New job near you" },
  listing_collected: { icon: "✅", title: "Collection confirmed" },
  dispute_raised: { icon: "⚖️", title: "A collection was disputed" },
  proof_disputed: { icon: "⚖️", title: "A collection was disputed" }
};

export function notificationCopy(kind) {
  return KIND_COPY[kind] || { icon: "🔔", title: "Update" };
}

function signedInUserId() {
  return scrapmanSession && scrapmanSession.user ? scrapmanSession.user.id : null;
}

/* Where a notification should take the user when tapped. */
export function notificationTarget(row) {
  if (!row) return null;
  if (row.kind === "new_job_nearby") return { screen: "jobs" };
  if (row.kind === "listing_collected") return { screen: "track" };
  if (row.kind === "dispute_raised" || row.kind === "proof_disputed") return { screen: "track" };
  return { screen: "account" };
}

export function setUnreadBadge(count) {
  unread = Number(count) || 0;
  const dot = document.getElementById("notifDot");
  if (!dot) return;
  dot.hidden = unread === 0;
  dot.textContent = unread > 9 ? "9+" : String(unread);
  const bell = document.getElementById("notifBell");
  if (bell) {
    bell.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
  }
}

export async function fetchNotifications() {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return [];
  const { data, error } = await scrapmanDb
    .from("notifications")
    .select("id,kind,title,body,listing_id,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return data || [];
}

export async function refreshUnreadBadge() {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return setUnreadBadge(0);
  const { count, error } = await scrapmanDb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  setUnreadBadge(error ? 0 : count || 0);
  return unread;
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function renderNotificationFeed(rows) {
  const list = document.getElementById("notificationList");
  if (!list) return;
  if (!rows || !rows.length) {
    list.innerHTML = `<p class="empty-note" id="notifEmpty">No notifications yet. We'll tell you the moment a job is listed near you.</p>`;
    return;
  }
  list.innerHTML = rows
    .map((row) => {
      const copy = notificationCopy(row.kind);
      const isUnread = !row.read_at;
      return `
        <button class="notif-row${isUnread ? " unread" : ""}" type="button"
                data-notif-id="${row.id}" data-listing-id="${row.listing_id == null ? "" : row.listing_id}">
          <span class="notif-icon" aria-hidden="true">${copy.icon}</span>
          <span class="notif-main">
            <span class="notif-title">${esc(row.title || copy.title)}</span>
            ${row.body ? `<span class="notif-body">${esc(row.body)}</span>` : ""}
            <span class="notif-time">${esc(relativeTime(row.created_at))}</span>
          </span>
          ${isUnread ? `<span class="notif-dot" aria-label="Unread"></span>` : ""}
        </button>`;
    })
    .join("");
}

export async function openNotifications() {
  openSheet("overlay-notifications");
  const list = document.getElementById("notificationList");
  if (list) list.innerHTML = `<p class="empty-note">Loading…</p>`;
  const rows = await fetchNotifications();
  renderNotificationFeed(rows);
}

export async function markAllNotificationsRead() {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return;
  await scrapmanDb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  setUnreadBadge(0);
  const rows = await fetchNotifications();
  renderNotificationFeed(rows);
}

async function openListingFromNotification(notifId, listingId) {
  const userId = signedInUserId();
  if (SCRAPMAN_AUTH_CONFIGURED && userId && notifId) {
    await scrapmanDb
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", Number(notifId))
      .eq("user_id", userId);
    refreshUnreadBadge();
  }
  closeSheet();
  const row = { kind: "new_job_nearby" };
  const target = notificationTarget(row);
  if (target && typeof window.scrapmanGoTo === "function") window.scrapmanGoTo(target.screen);
  else if (typeof window.scrapmanGoTo === "function") window.scrapmanGoTo("jobs");
  // listingId is intentionally unused beyond the read receipt: the Jobs screen already
  // renders every open listing, so deep-linking to one card would fight its own filter UI.
  void listingId;
}

/* ---------- collector alert preferences (service area + radius + opt-in) ---------- */

export async function loadNotificationPrefs() {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return null;
  const { data, error } = await scrapmanDb
    .from("collector_profiles")
    .select("service_lat,service_lng,service_radius_miles,notify_new_jobs")
    .eq("profile_id", userId)
    .maybeSingle();
  return error ? null : data;
}

export async function saveNotificationPrefs(values) {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return { ok: false, error: "Sign in first." };
  const radius = Number(values.radiusMiles);
  if (!Number.isFinite(radius) || radius < 1 || radius > 100) {
    return { ok: false, error: "Choose a radius between 1 and 100 miles." };
  }
  const { error } = await scrapmanDb
    .from("collector_profiles")
    .update({
      service_lat: values.lat,
      service_lng: values.lng,
      service_radius_miles: radius,
      notify_new_jobs: Boolean(values.enabled)
    })
    .eq("profile_id", userId);
  return error ? { ok: false, error: "Could not save your alert settings." } : { ok: true };
}

/* ---------- web push (only when a VAPID public key is configured) ---------- */

export function pushSupported() {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(window.SCRAPMAN_VAPID_PUBLIC_KEY)
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/* Subscribes this browser and stores the endpoint so a sender can reach it later.
   Returns { ok, reason } — callers show the reason verbatim rather than claiming
   alerts are on when the permission was denied or no key is configured. */
export async function enablePushNotifications() {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: "Device alerts aren't configured on this deployment yet — in-app notifications still work."
    };
  }
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId) return { ok: false, reason: "Sign in first." };

  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Notifications are blocked in your browser settings." };

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.SCRAPMAN_VAPID_PUBLIC_KEY)
    }));

  const json = subscription.toJSON();
  const { error } = await scrapmanDb.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys ? json.keys.p256dh : "",
      auth: json.keys ? json.keys.auth : "",
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, reason: "Could not save this device for alerts." };
  return { ok: true };
}

/* ---------- boot ---------- */

export function initNotifications() {
  const bell = document.getElementById("notifBell");
  if (bell) bell.addEventListener("click", openNotifications);

  const markAll = document.getElementById("markAllRead");
  if (markAll) markAll.addEventListener("click", markAllNotificationsRead);

  const list = document.getElementById("notificationList");
  if (list) {
    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-notif-id]");
      if (!row) return;
      openListingFromNotification(row.getAttribute("data-notif-id"), row.getAttribute("data-listing-id"));
    });
  }

  refreshUnreadBadge();
  subscribeToNotificationInserts();
}

export function subscribeToNotificationInserts() {
  const userId = signedInUserId();
  if (!SCRAPMAN_AUTH_CONFIGURED || !userId || realtimeChannel || !scrapmanDb.channel) return;
  realtimeChannel = scrapmanDb
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => {
        setUnreadBadge(unread + 1);
        if (!document.getElementById("overlay-notifications")) return;
        const sheet = document.getElementById("overlay-notifications");
        if (sheet && sheet.classList.contains("open")) {
          const list = document.getElementById("notificationList");
          const empty = document.getElementById("notifEmpty");
          if (empty) empty.remove();
          if (list && payload && payload.new) {
            const rows = [payload.new];
            renderNotificationFeed(rows.concat([]));
          }
        }
      }
    )
    .subscribe();
}

export function unsubscribeFromNotifications() {
  if (realtimeChannel && scrapmanDb.removeChannel) scrapmanDb.removeChannel(realtimeChannel);
  realtimeChannel = null;
  setUnreadBadge(0);
}
