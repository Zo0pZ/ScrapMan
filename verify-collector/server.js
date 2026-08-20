/* ScrapMan — small cPanel Node.js App that does three unrelated jobs:
 *
 *   1. Collector verification proxy (original purpose — see checkCarrierRegistration /
 *      checkScrapMetalLicence below). Browsers can't call environment.data.gov.uk
 *      directly (no CORS header), so this runs server-side and hands back a small,
 *      safe-to-trust verdict.
 *
 *   2. Stripe billing (added later) — job-unlock one-off payments and the Pro
 *      subscription. Stripe's secret key and Supabase's service_role key can only
 *      ever live server-side, so checkout-session creation, the webhook, and the
 *      customer-portal link all live here too rather than duplicating this app.
 *
 *   3. Collector dashboard material prices (see fetchLiveMetalPrices/handleMetalPrices
 *      below) — proxies metals.dev so its API key never reaches the browser, and
 *      caches the result for a day.
 *
 * IMPORTANT (verification): "verified" is only ever set from an *exact*
 * registrationNumber match against a record returned by the EA. Fuzzy/prefix search
 * results (used only to be lenient about how someone typed their number) are returned
 * for display but never flip verified to true on their own — getting this wrong would
 * mean a mistyped or unrelated licence number could pass as "verified".
 *
 * Data source: Environment Agency Public Registers Online API.
 * https://environment.data.gov.uk/public-register/view/api-reference
 * Licensed under the Environment Agency Conditional Licence — commercial
 * use is permitted; responses must be attributed:
 * "Contains Environment Agency information © Environment Agency and/or
 * database right."
 *
 * Deploy: cPanel → Software → Setup Node.js App. Application root = this
 * folder, Application URL = whatever path app.js's VERIFY_ENDPOINT/BILLING_ENDPOINT
 * point at (e.g. yourdomain.com/verify-collector), startup file = server.js.
 * Env vars (set via the cPanel Node App UI, or a local .env for `stripe listen` /
 * manual testing — see .env.example): SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 * STRIPE_PRICE_UNLOCK, STRIPE_PRICE_PRO, METALS_DEV_API_KEY, DOMAIN, PORT.
 *
 * Routing note: cPanel's Node app proxy may or may not strip the mount path
 * (e.g. "/verify-collector") before it reaches this process, so every route below
 * is matched by *suffix* rather than assuming an exact pathname — that way it works
 * the same whether req.url arrives as "/create-checkout-session" or
 * "/verify-collector/create-checkout-session". Anything that matches none of the
 * known suffixes falls through to the original verification handler, which is what
 * every request used to hit anyway (it never looked at the path at all).
 */

require("dotenv").config();
const http = require("http");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const PRO_BASE = "https://environment.data.gov.uk/public-register";
const COUNCIL_SUFFIXES = /\s*(city|metropolitan|borough|district|unitary|county)?\s*council\s*$/i;

const METALS_API_BASE = "https://api.metals.dev/v1";
const METAL_PRICE_CACHE_MS = 24 * 60 * 60 * 1000; // 1 day — matches the "updated daily" the dashboard promises

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function normalizeCouncilName(name) {
  return String(name || "").replace(COUNCIL_SUFFIXES, "").trim();
}

function cleanRegNumber(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s\-\/]+/g, "");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isExpired(expiryDate) {
  return !!expiryDate && expiryDate < todayISO();
}

async function proFetch(path, params) {
  const url = new URL(`${PRO_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PRO ${path} responded ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

/* Waste carrier / broker / dealer registration — the "CBDU..." style number. */
async function checkCarrierRegistration(rawRegNumber) {
  const clean = cleanRegNumber(rawRegNumber);
  if (!clean) return { checked: false };

  const items = await proFetch("/waste-carriers-brokers/registration.json", {
    "number-search": clean,
    _limit: "5"
  });

  const exact = items.find(i => cleanRegNumber(i.registrationNumber) === clean);
  if (!exact) {
    return { checked: true, found: false, closestMatches: items.slice(0, 3).map(i => i.registrationNumber) };
  }
  return {
    checked: true,
    found: true,
    expired: isExpired(exact.expiryDate),
    registrationNumber: exact.registrationNumber,
    holderName: exact.holder && exact.holder.name,
    tier: exact.regime && exact.regime.prefLabel,
    expiryDate: exact.expiryDate,
    registrationDate: exact.registrationDate
  };
}

/* Scrap Metal Dealers Act 2013 licence — council-issued, aggregated nationally by the EA. */
async function checkScrapMetalLicence(rawCouncil, rawLicenceNumber) {
  const council = normalizeCouncilName(rawCouncil);
  const clean = cleanRegNumber(rawLicenceNumber);
  if (!council || !clean) return { checked: false };

  const items = await proFetch("/scrap-metal-dealers/registration.json", {
    "local-authority": council,
    "number-search": clean,
    _limit: "5"
  });

  const exact = items.find(i => cleanRegNumber(i.registrationNumber) === clean);
  if (!exact) {
    return {
      checked: true, found: false,
      searchedCouncil: council,
      closestMatches: items.slice(0, 3).map(i => ({ number: i.registrationNumber, council: i.localAuthority && i.localAuthority.prefLabel }))
    };
  }
  return {
    checked: true,
    found: true,
    expired: isExpired(exact.expiryDate),
    registrationNumber: exact.registrationNumber,
    holderName: exact.holder && (exact.holder.name || (exact.holder.memberOf && exact.holder.memberOf.businessName)),
    localAuthority: exact.localAuthority && exact.localAuthority.prefLabel,
    registrationType: exact.registrationType && exact.registrationType.label,
    expiryDate: exact.expiryDate
  };
}

async function handleVerify(req, res, params) {
  const { carrierRef, council, licenceNumber } = params;
  if (!carrierRef && !licenceNumber) {
    return sendJSON(res, 400, { error: "Provide carrierRef and/or (council + licenceNumber)" });
  }

  try {
    const [carrier, scrapMetalLicence] = await Promise.all([
      checkCarrierRegistration(carrierRef),
      checkScrapMetalLicence(council, licenceNumber)
    ]);

    const carrierOK = carrier.checked ? (carrier.found && !carrier.expired) : true;
    const licenceOK = scrapMetalLicence.checked ? (scrapMetalLicence.found && !scrapMetalLicence.expired) : true;
    const anyChecked = carrier.checked || scrapMetalLicence.checked;

    sendJSON(res, 200, {
      verified: anyChecked && carrierOK && licenceOK,
      carrier,
      scrapMetalLicence,
      source: "Environment Agency Public Registers Online",
      attribution: "Contains Environment Agency information © Environment Agency and/or database right.",
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    sendJSON(res, 502, {
      error: "Couldn't reach the Environment Agency register — try again shortly.",
      detail: String(err.message || err)
    });
  }
}

/* ---------- Collector dashboard: live scrap metal prices ----------
 * Copper/aluminium/zinc/lead spot prices (GBP/kg) via metals.dev — LME data. The API
 * key must never reach the browser (same reasoning as STRIPE_SECRET_KEY above), so this
 * proxies it server-side and caches the result for a day rather than calling metals.dev
 * on every dashboard load. Brass and heavy steel aren't LME-traded commodities, so the
 * client derives guide prices for those from what this endpoint returns instead of
 * expecting them here. */
let metalPriceCache = null; // { rates, fetchedAt } | null

async function fetchLiveMetalPrices() {
  const apiKey = process.env.METALS_DEV_API_KEY;
  if (!apiKey) throw new Error("METALS_DEV_API_KEY not configured");

  const url = `${METALS_API_BASE}/latest?api_key=${encodeURIComponent(apiKey)}&currency=GBP&unit=kg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`metals.dev responded ${res.status}`);
  const body = await res.json();
  if (body.status && body.status !== "success") throw new Error(body.error_message || "metals.dev returned an error");

  const metals = body.metals || body.rates || {};
  const rates = {
    copper: Number(metals.copper),
    aluminum: Number(metals.aluminum),
    zinc: Number(metals.zinc),
    lead: Number(metals.lead)
  };
  if (Object.values(rates).some(v => !Number.isFinite(v))) {
    throw new Error("Unexpected metals.dev response shape");
  }
  return rates;
}

async function handleMetalPrices(req, res) {
  const now = Date.now();
  if (metalPriceCache && (now - metalPriceCache.fetchedAt) < METAL_PRICE_CACHE_MS) {
    return sendJSON(res, 200, { live: true, fetchedAt: new Date(metalPriceCache.fetchedAt).toISOString(), rates: metalPriceCache.rates });
  }
  try {
    const rates = await fetchLiveMetalPrices();
    metalPriceCache = { rates, fetchedAt: now };
    return sendJSON(res, 200, { live: true, fetchedAt: new Date(now).toISOString(), rates });
  } catch (err) {
    console.error("metal-prices fetch failed:", err.message || err);
    // A stale cached price is still more useful than none — only give up entirely
    // (and let the client fall back to its own static guide rates) if we've never
    // had a successful fetch at all.
    if (metalPriceCache) {
      return sendJSON(res, 200, { live: true, fetchedAt: new Date(metalPriceCache.fetchedAt).toISOString(), rates: metalPriceCache.rates, stale: true });
    }
    return sendJSON(res, 200, { live: false, fetchedAt: null, rates: null });
  }
}

/* ---------- Supabase helpers (service_role — server-side only, bypasses RLS) ---------- */

/* Resolves the signed-in collector's id from their Supabase access token — never trust
   a collector_id/user_id passed in the request body itself, since that'd let anyone
   unlock jobs (or subscribe) as someone else just by editing the request. */
async function resolveCollectorId(authHeader) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

/* Upsert via PostgREST using the service_role key — Prefer: resolution=merge-duplicates
   makes this safe to call more than once for the same row (Stripe can and does deliver
   the same webhook event more than once). */
async function supabaseUpsert(table, row) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error(`Supabase upsert into ${table} failed: ${res.status} ${await res.text()}`);
}

async function supabasePatch(table, filterQuery, patch) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`Supabase patch on ${table} failed: ${res.status} ${await res.text()}`);
}

/* ---------- Stripe: checkout sessions + customer portal ---------- */

async function handleCreateUnlockSession(req, res, body) {
  const collectorId = await resolveCollectorId(req.headers.authorization);
  if (!collectorId) return sendJSON(res, 401, { error: "Sign in and try again." });

  const listingId = body && body.listingId;
  if (!listingId) return sendJSON(res, 400, { error: "Missing listingId" });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: process.env.STRIPE_PRICE_UNLOCK, quantity: 1 }],
    client_reference_id: collectorId,
    metadata: { type: "job_unlock", listing_id: String(listingId), collector_id: collectorId },
    success_url: `${process.env.DOMAIN}/?stripe=success&flow=unlock&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.DOMAIN}/?stripe=cancel&flow=unlock`
  });
  sendJSON(res, 200, { url: session.url });
}

async function handleCreateProSession(req, res) {
  const collectorId = await resolveCollectorId(req.headers.authorization);
  if (!collectorId) return sendJSON(res, 401, { error: "Sign in and try again." });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    client_reference_id: collectorId,
    metadata: { type: "pro_subscription", collector_id: collectorId },
    success_url: `${process.env.DOMAIN}/?stripe=success&flow=pro&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.DOMAIN}/?stripe=cancel&flow=pro`
  });
  sendJSON(res, 200, { url: session.url });
}

async function handleCustomerPortal(req, res) {
  const collectorId = await resolveCollectorId(req.headers.authorization);
  if (!collectorId) return sendJSON(res, 401, { error: "Sign in and try again." });

  const lookup = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pro_subscriptions?collector_id=eq.${collectorId}&select=stripe_customer_id`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const rows = await lookup.json();
  const customerId = rows && rows[0] && rows[0].stripe_customer_id;
  if (!customerId) return sendJSON(res, 404, { error: "No Pro subscription found for this account." });

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.DOMAIN}/?screen=account`
  });
  sendJSON(res, 200, { url: portalSession.url });
}

/* ---------- Stripe webhook — the only thing allowed to actually grant an unlock or
   activate/cancel Pro. Everything above just starts a Checkout Session; nothing is
   provisioned until Stripe confirms the payment here. ---------- */

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1e6) req.destroy();
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Stripe moved current_period_end from the Subscription object down to each
// subscription item on newer API versions/accounts — read whichever is present
// rather than assuming one shape.
function subscriptionPeriodEnd(subscription) {
  const seconds = subscription.current_period_end
    || (subscription.items && subscription.items.data[0] && subscription.items.data[0].current_period_end);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function fulfillCheckoutSession(session) {
  const meta = session.metadata || {};

  if (meta.type === "job_unlock") {
    await supabaseUpsert("job_unlocks", {
      listing_id: Number(meta.listing_id),
      collector_id: meta.collector_id,
      amount_pence: session.amount_total,
      currency: session.currency,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent
    });
    return;
  }

  if (meta.type === "pro_subscription") {
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    await supabaseUpsert("pro_subscriptions", {
      collector_id: meta.collector_id,
      stripe_customer_id: session.customer,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscriptionPeriodEnd(subscription)
    });
  }
}

async function syncSubscriptionStatus(subscription) {
  await supabasePatch(
    "pro_subscriptions",
    `stripe_subscription_id=eq.${subscription.id}`,
    { status: subscription.status, current_period_end: subscriptionPeriodEnd(subscription) }
  );
}

async function handleWebhook(req, res) {
  const rawBody = await readRawBody(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await fulfillCheckoutSession(event.data.object);
        break;
      case "customer.subscription.updated":
        await syncSubscriptionStatus(event.data.object);
        break;
      case "customer.subscription.deleted":
        await syncSubscriptionStatus({ ...event.data.object, status: "canceled" });
        break;
    }
  } catch (err) {
    // Returning 500 makes Stripe retry the event later rather than silently dropping it.
    console.error(`webhook handler failed for ${event.type}:`, err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("Internal error");
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end("{}");
}

/* ---------- plumbing ---------- */

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // guard against absurdly large bodies
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(payload));
}

function endsWithPath(pathname, suffix) {
  return pathname === suffix || pathname.endsWith(suffix);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // Webhook needs the raw, unparsed body for signature verification — handle it before
  // anything else touches the request stream.
  if (req.method === "POST" && endsWithPath(pathname, "/webhook")) {
    try { return await handleWebhook(req, res); }
    catch (err) { return sendJSON(res, 500, { error: String(err.message || err) }); }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return sendJSON(res, 405, { error: "Use GET or POST" });
  }

  try {
    if (req.method === "GET" && endsWithPath(pathname, "/metal-prices")) {
      return await handleMetalPrices(req, res);
    }
    if (req.method === "POST" && endsWithPath(pathname, "/create-checkout-session")) {
      return await handleCreateUnlockSession(req, res, await readJSONBody(req));
    }
    if (req.method === "POST" && endsWithPath(pathname, "/create-subscription-session")) {
      return await handleCreateProSession(req, res);
    }
    if (req.method === "POST" && endsWithPath(pathname, "/customer-portal")) {
      return await handleCustomerPortal(req, res);
    }
  } catch (err) {
    return sendJSON(res, 502, { error: "Stripe/Supabase request failed — try again shortly.", detail: String(err.message || err) });
  }

  // Fallback: the original collector-verification handler. This intentionally ignores
  // the path (it always has — every request used to land here regardless of URL).
  let params;
  try {
    params = req.method === "POST"
      ? await readJSONBody(req)
      : Object.fromEntries(new URL(req.url, `http://${req.headers.host}`).searchParams);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON body" });
  }
  return handleVerify(req, res, params);
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`verify-collector listening on ${port}`));
