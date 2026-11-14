"use strict";

/* ScrapMan — pure helpers for the Environment Agency verification checks.
 *
 * Extracted verbatim from server.js so they can be unit-tested without spinning up
 * an HTTP server or reaching the EA register. Nothing here performs I/O.
 */

/* Council names arrive in many shapes ("Bristol City Council", "St Helens Council",
   "Powys County Council") but the EA register wants the bare authority name.
   NOTE: this is a single pass on purpose — "Leeds Metropolitan District Council"
   reduces to "Leeds Metropolitan", not "Leeds". Changing that would alter the
   local-authority search term sent to the register, so it is left exactly as it
   was until the EA's matching behaviour is confirmed. */
const COUNCIL_SUFFIXES = /\s*(city|metropolitan|borough|district|unitary|county)?\s*council\s*$/i;

function normalizeCouncilName(name) {
  return String(name || "").replace(COUNCIL_SUFFIXES, "").trim();
}

/* Registration and licence numbers are compared for an EXACT match, so spacing,
   case and separator style must not matter ("CBU 123/45-6" === "cbu123456"). */
function cleanRegNumber(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s\-/]+/g, "");
}

function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/* Dates from the register are plain ISO day strings, so a string comparison is
   correct and avoids timezone drift from parsing into Date. */
function isExpired(expiryDate, today = todayISO()) {
  return !!expiryDate && expiryDate < today;
}

/* The exact-match rule that decides "verified": fuzzy/prefix hits from the register
   are only ever returned for display and must never flip verified to true. */
function findExactRegistration(items, clean) {
  if (!Array.isArray(items) || !clean) return null;
  return items.find((item) => cleanRegNumber(item && item.registrationNumber) === clean) || null;
}

module.exports = {
  COUNCIL_SUFFIXES,
  normalizeCouncilName,
  cleanRegNumber,
  todayISO,
  isExpired,
  findExactRegistration
};
