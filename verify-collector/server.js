/* ScrapMan — collector verification proxy (cPanel Node.js App).
 *
 * Browsers can't call environment.data.gov.uk directly (it sends no
 * Access-Control-Allow-Origin header), so this runs server-side and hands
 * back a small, safe-to-trust verdict.
 *
 * IMPORTANT: "verified" is only ever set from an *exact* registrationNumber
 * match against a record returned by the EA. Fuzzy/prefix search results
 * (used only to be lenient about how someone typed their number) are
 * returned for display but never flip verified to true on their own —
 * getting this wrong would mean a mistyped or unrelated licence number
 * could pass as "verified".
 *
 * Data source: Environment Agency Public Registers Online API.
 * https://environment.data.gov.uk/public-register/view/api-reference
 * Licensed under the Environment Agency Conditional Licence — commercial
 * use is permitted; responses must be attributed:
 * "Contains Environment Agency information © Environment Agency and/or
 * database right."
 *
 * Deploy: cPanel → Software → Setup Node.js App. Application root = this
 * folder, Application URL = whatever path app.js's VERIFY_ENDPOINT points
 * at (e.g. yourdomain.com/verify-collector), startup file = server.js.
 * No dependencies to install — global fetch is built into Node 18+.
 */

const http = require("http");

const PRO_BASE = "https://environment.data.gov.uk/public-register";
const COUNCIL_SUFFIXES = /\s*(city|metropolitan|borough|district|unitary|county)?\s*council\s*$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJSON(res, 405, { error: "Use GET or POST" });
  }

  let params;
  try {
    params = req.method === "POST"
      ? await readJSONBody(req)
      : Object.fromEntries(new URL(req.url, `http://${req.headers.host}`).searchParams);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON body" });
  }

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
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`verify-collector listening on ${port}`));
