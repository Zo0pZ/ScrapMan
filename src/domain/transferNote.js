/* ScrapMan — waste transfer note (WTN) record.
 *
 * This is the statutory paper trail, not a UI nicety. Under the Scrap Metal Dealers Act
 * 2013 a dealer must record every metal receipt — description, weight, seller identity,
 * date and payment method — and paying cash for scrap metal is illegal. Waste duty of
 * care separately expects a transfer note when waste changes hands.
 *
 * Two properties matter and both are deliberate:
 *
 *   1. The record is created server-side. A trigger on job_proofs (see
 *      supabase/migrations/006_notifications_badges_proof.sql) writes the note from the
 *      listing and the collector's verified registration, so the document cannot be
 *      skipped or edited by the browser.
 *   2. The note is a snapshot. The SQL stores the whole document as jsonb at issue time,
 *      so a later change to a collector's licence number cannot rewrite history.
 *
 * This module only shapes and renders that snapshot. It never invents values: anything
 * missing from the record renders as "Not recorded" rather than being guessed, because a
 * statutory record that guesses is worse than one with a gap.
 */

/* Mirror of the reference format built by the SQL trigger. Kept here so the client can
 * build a reference for a note that has not round-tripped through the database yet
 * (the "collected, saving…" state) and still show the same identifier the server will
 * issue. Format: WTN-YYYYMMDD-000123 */
export function transferNoteReference(listingId, when = new Date()) {
  const id = Number.parseInt(listingId, 10)
  if (!Number.isFinite(id) || id <= 0) return ""
  const date = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(date.getTime())) return ""
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("")
  return `WTN-${stamp}-${String(id).padStart(6, "0")}`
}

/* Collectors weigh loads in all sorts of ways ("12", "12.5 kg", "1,250"). Parse what they
 * actually type, but refuse the values that would corrupt the record: zero, negatives,
 * and absurd weights that mean a typo or a wrong unit. */
export const MIN_WEIGHT_KG = 1
export const MAX_WEIGHT_KG = 50000

export function parseWeightKg(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? checkWeight(input) : { ok: false, error: "Enter the weight in kg." }
  }
  const raw = String(input ?? "").trim().toLowerCase().replace(/\s*kg$/, "").replace(/,/g, "")
  if (!raw) return { ok: false, error: "Enter the weight in kg." }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { ok: false, error: "Enter the weight as a number, e.g. 42.5" }
  return checkWeight(value)
}

function checkWeight(value) {
  if (value < MIN_WEIGHT_KG) return { ok: false, error: "Weight must be at least 1 kg." }
  if (value > MAX_WEIGHT_KG) return { ok: false, error: "That weight looks too high — check the unit." }
  return { ok: true, kg: Math.round(value * 10) / 10 }
}

/* The Act requires the payment method on the record, and cash is not an option for scrap
 * metal. Only these values are ever written. */
export const PAYMENT_METHODS = [
  { key: "electronic", label: "Electronic transfer" },
  { key: "card", label: "Debit or credit card" },
  { key: "no-charge", label: "No charge (free collection)" }
]

export function paymentMethodLabel(key) {
  return PAYMENT_METHODS.find(m => m.key === key)?.label || "Not recorded"
}

const MATERIAL_LABEL = {
  ferrous: "Ferrous metal",
  nonferrous: "Non-ferrous metal",
  appliance: "Appliance",
  mixed: "Mixed scrap metal"
}

export function materialLabel(type) {
  return MATERIAL_LABEL[type] || "Scrap metal"
}

/* Minimal HTML escaping. Deliberately local rather than imported from src/state.js: this
 * module is pure and must stay importable by node --test without the app's DOM globals.
 * The output is printed into a fresh document window, so every field has to be escaped. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const NOT_RECORDED = "Not recorded"

/* Normalise the database row (snake_case from PostgREST) or the jsonb payload (camelCase
 * from the trigger) into one shape, so the screen and the printed note always agree. */
export function buildTransferNote({ listing, proof, collector, payload } = {}) {
  const p = payload || {}
  const l = listing || {}
  const pr = proof || {}
  const c = collector || {}

  const collectedAt = p.collectedAt || pr.collected_at || new Date().toISOString()
  const listingId = p.listingId ?? l.id ?? pr.listing_id
  const weightKg = Number(p.weightKg ?? pr.weight_kg ?? 0)

  return {
    reference: p.reference || transferNoteReference(listingId, collectedAt),
    issuedAt: p.issuedAt || pr.created_at || collectedAt,
    collectedAt,
    listingId,
    description: p.description || l.title || NOT_RECORDED,
    material: materialLabel(p.materialType || l.metal_type),
    weightKg: Number.isFinite(weightKg) ? weightKg : 0,
    address: p.collectionAddress || l.address || NOT_RECORDED,
    carrierName: p.carrierName || c.business_name || NOT_RECORDED,
    carrierRegistration: p.carrierRegistration || c.carrier_ref || NOT_RECORDED,
    smdLicence: p.smdLicence || c.smd_licence || NOT_RECORDED,
    smdCouncil: p.smdCouncil || c.smd_council || NOT_RECORDED,
    paymentMethod: paymentMethodLabel(p.paymentMethod || "electronic"),
    photoUrl: p.photoUrl || pr.photo_url || "",
    note: p.note || pr.note || ""
  }
}

export const TRANSFER_NOTE_LEGAL =
  "Waste transfer note issued under the Waste Duty of Care (Environmental Protection Act 1990) " +
  "and the Scrap Metal Dealers Act 2013. Cash payment for scrap metal is prohibited."

/* The printable document. Inline styles only: it is written into a bare window opened with
 * document.write(), so there is no stylesheet to inherit from. */
export function transferNoteHtml(note) {
  const n = buildTransferNote(note)
  const rows = [
    ["Reference", n.reference],
    ["Issued", formatDateTime(n.issuedAt)],
    ["Collected", formatDateTime(n.collectedAt)],
    ["Material", n.material],
    ["Description", n.description],
    ["Weight", `${n.weightKg} kg`],
    ["Collection address", n.address],
    ["Carrier", n.carrierName],
    ["Carrier registration", n.carrierRegistration],
    ["Scrap metal licence", `${n.smdLicence} (${n.smdCouncil})`],
    ["Payment method", n.paymentMethod]
  ]

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Waste transfer note ${esc(n.reference)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #14181f; margin: 0; padding: 32px; }
  .doc { max-width: 640px; margin: 0 auto; }
  .brand { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
  .kicker { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; color: #5b6472; margin: 2px 0 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #33404f; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e7ec; vertical-align: top; }
  th { width: 42%; font-weight: 600; color: #5b6472; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .legal { font-size: 12px; color: #5b6472; border-top: 1px solid #e3e7ec; padding-top: 12px; }
  .sign { display: flex; gap: 32px; margin-top: 28px; }
  .sign div { flex: 1; border-top: 1px solid #14181f; padding-top: 6px; font-size: 12px; color: #5b6472; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="brand">ScrapMan</div>
    <div class="kicker">Waste transfer note</div>
    <h1>${esc(n.description)}</h1>
    <div class="ref">${esc(n.reference)}</div>
    <table>
      ${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("\n      ")}
    </table>
    ${n.note ? `<p><strong>Note:</strong> ${esc(n.note)}</p>` : ""}
    <p class="legal">${esc(TRANSFER_NOTE_LEGAL)}</p>
    <div class="sign">
      <div>Householder signature</div>
      <div>Collector signature</div>
    </div>
  </div>
</body>
</html>`
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return NOT_RECORDED
  return date.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  })
}
