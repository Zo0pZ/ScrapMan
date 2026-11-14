import test from "node:test"
import assert from "node:assert/strict"

import {
  transferNoteReference,
  parseWeightKg,
  paymentMethodLabel,
  materialLabel,
  buildTransferNote,
  transferNoteHtml,
  formatDateTime,
  MIN_WEIGHT_KG,
  MAX_WEIGHT_KG
} from "../../src/domain/transferNote.js"

test("reference matches the SQL trigger format and is stable per listing and day", () => {
  const when = new Date("2026-03-04T10:15:00Z")
  assert.equal(transferNoteReference(123, when), "WTN-20260304-000123")
  assert.equal(transferNoteReference("123", when), "WTN-20260304-000123")
  assert.equal(transferNoteReference(7, when), "WTN-20260304-000007")
  assert.equal(transferNoteReference(123, when), transferNoteReference(123, when))
})

test("reference refuses ids that cannot exist", () => {
  assert.equal(transferNoteReference(0), "")
  assert.equal(transferNoteReference(null), "")
  assert.equal(transferNoteReference("abc"), "")
  assert.equal(transferNoteReference(5, new Date("nope")), "")
})

test("weight parsing accepts what collectors actually type", () => {
  assert.deepEqual(parseWeightKg("42"), { ok: true, kg: 42 })
  assert.deepEqual(parseWeightKg("42.5"), { ok: true, kg: 42.5 })
  assert.deepEqual(parseWeightKg("42.5 kg"), { ok: true, kg: 42.5 })
  assert.deepEqual(parseWeightKg(" 42.5 KG "), { ok: true, kg: 42.5 })
  assert.deepEqual(parseWeightKg("1,250"), { ok: true, kg: 1250 })
  assert.deepEqual(parseWeightKg(42.5), { ok: true, kg: 42.5 })
  assert.deepEqual(parseWeightKg("42.55"), { ok: true, kg: 42.6 })
})

test("weight parsing rejects the values that would corrupt the record", () => {
  assert.equal(parseWeightKg("").ok, false)
  assert.equal(parseWeightKg("   ").ok, false)
  assert.equal(parseWeightKg(null).ok, false)
  assert.equal(parseWeightKg("heavy").ok, false)
  assert.equal(parseWeightKg(0).ok, false)
  assert.equal(parseWeightKg("-3").ok, false)
  assert.equal(parseWeightKg(String(MAX_WEIGHT_KG + 1)).ok, false)
  assert.equal(parseWeightKg(String(MIN_WEIGHT_KG)).ok, true)
  assert.equal(parseWeightKg("NaN").ok, false)
})

test("payment methods never include cash", () => {
  assert.equal(paymentMethodLabel("electronic"), "Electronic transfer")
  assert.equal(paymentMethodLabel("cash"), "Not recorded")
  assert.equal(paymentMethodLabel(undefined), "Not recorded")
  assert.doesNotMatch(paymentMethodLabel("cash").toLowerCase(), /cash/)
})

test("material labels cover every listing type plus a fallback", () => {
  assert.equal(materialLabel("ferrous"), "Ferrous metal")
  assert.equal(materialLabel("nonferrous"), "Non-ferrous metal")
  assert.equal(materialLabel("appliance"), "Appliance")
  assert.equal(materialLabel("mixed"), "Mixed scrap metal")
  assert.equal(materialLabel("unknown"), "Scrap metal")
})

test("buildTransferNote normalises a jsonb payload from the trigger", () => {
  const note = buildTransferNote({
    payload: {
      reference: "WTN-20260304-000123",
      listingId: 123,
      collectedAt: "2026-03-04T10:15:00Z",
      description: "Old washing machine",
      materialType: "appliance",
      weightKg: 38.5,
      collectionAddress: "B14 7QH",
      carrierName: "Smith Metals Ltd",
      carrierRegistration: "CBDU123456",
      smdLicence: "SMD/2024/001",
      smdCouncil: "Birmingham",
      paymentMethod: "electronic"
    }
  })

  assert.equal(note.reference, "WTN-20260304-000123")
  assert.equal(note.description, "Old washing machine")
  assert.equal(note.material, "Appliance")
  assert.equal(note.weightKg, 38.5)
  assert.equal(note.carrierName, "Smith Metals Ltd")
  assert.equal(note.smdCouncil, "Birmingham")
  assert.equal(note.paymentMethod, "Electronic transfer")
})

test("buildTransferNote falls back to snake_case rows before the trigger runs", () => {
  const note = buildTransferNote({
    listing: { id: 9, title: "Copper pipe", metal_type: "nonferrous", address: "M1 2AB" },
    proof: { listing_id: 9, weight_kg: "12.0", collected_at: "2026-05-01T09:00:00Z" },
    collector: { business_name: "Raven Scrap", carrier_ref: "CBDU999", smd_licence: "SMD/9", smd_council: "Manchester" }
  })

  assert.equal(note.reference, transferNoteReference(9, "2026-05-01T09:00:00Z"))
  assert.equal(note.weightKg, 12)
  assert.equal(note.material, "Non-ferrous metal")
  assert.equal(note.carrierName, "Raven Scrap")
  assert.equal(note.carrierRegistration, "CBDU999")
})

test("a missing value is recorded as missing, never invented", () => {
  const note = buildTransferNote({ listing: { id: 4, title: "Radiator" } })
  assert.equal(note.carrierName, "Not recorded")
  assert.equal(note.carrierRegistration, "Not recorded")
  assert.equal(note.smdLicence, "Not recorded")
  assert.equal(note.address, "Not recorded")
  assert.equal(note.weightKg, 0)
})

test("printed note escapes user-supplied text and includes the legal basis", () => {
  const html = transferNoteHtml({
    payload: {
      reference: "WTN-20260101-000001",
      description: "<script>alert(1)</script>",
      carrierName: 'Bad "Actor" & Sons',
      weightKg: 5,
      collectionAddress: "B1 1AA"
    }
  })

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /Bad &quot;Actor&quot; &amp; Sons/)
  assert.match(html, /Scrap Metal Dealers Act 2013/)
  assert.match(html, /WTN-20260101-000001/)
  assert.match(html, /Householder signature/)
})

test("formatDateTime renders en-GB and degrades on bad input", () => {
  assert.equal(formatDateTime("nonsense"), "Not recorded")
  assert.match(formatDateTime("2026-03-04T10:15:00Z"), /2026/)
})
