import test from "node:test"
import assert from "node:assert/strict"

import {
  BADGE_TIERS,
  badgeForKg,
  nextBadge,
  badgeProgress,
  badgeSummary,
  formatKg,
  toKg
} from "../../src/domain/badges.js"

test("toKg coerces PostgREST numeric strings, nulls and junk to a number", () => {
  assert.equal(toKg("125.5"), 125.5)
  assert.equal(toKg(125.5), 125.5)
  assert.equal(toKg(null), 0)
  assert.equal(toKg(undefined), 0)
  assert.equal(toKg("not-a-number"), 0)
  assert.equal(toKg(-5), 0)
})

test("a household with nothing collected still holds Bronze", () => {
  assert.equal(badgeForKg(0).key, "bronze")
  assert.equal(badgeForKg(null).key, "bronze")
})

test("tier boundaries are inclusive at the floor", () => {
  assert.equal(badgeForKg(49.9).key, "bronze")
  assert.equal(badgeForKg(50).key, "silver")
  assert.equal(badgeForKg(199).key, "silver")
  assert.equal(badgeForKg(200).key, "gold")
  assert.equal(badgeForKg(499).key, "gold")
  assert.equal(badgeForKg(500).key, "platinum")
  assert.equal(badgeForKg(99999).key, "platinum")
})

test("nextBadge walks up the tiers and stops at the top", () => {
  assert.equal(nextBadge(0).key, "silver")
  assert.equal(nextBadge(60).key, "gold")
  assert.equal(nextBadge(250).key, "platinum")
  assert.equal(nextBadge(500), null)
})

test("progress is measured from the current tier floor, not from zero", () => {
  // 125kg is halfway from Silver (50) to Gold (200).
  const half = badgeProgress(125, 3)
  assert.equal(half.tier.key, "silver")
  assert.equal(half.next.key, "gold")
  assert.equal(half.pct, 50)
  assert.equal(half.kgToNext, 75)
  assert.equal(half.collections, 3)

  // Freshly promoted households restart at 0%, so the bar is not permanently full.
  assert.equal(badgeProgress(50, 1).pct, 0)
})

test("top tier reports a complete bar and no remaining kilos", () => {
  const top = badgeProgress(600, 12)
  assert.equal(top.tier.key, "platinum")
  assert.equal(top.next, null)
  assert.equal(top.pct, 100)
  assert.equal(top.kgToNext, 0)
})

test("progress never goes negative or above 100", () => {
  assert.equal(badgeProgress(-20, 0).pct, 0)
  assert.equal(badgeProgress(1e9, 0).pct, 100)
})

test("collection counts are floored and default to zero", () => {
  assert.equal(badgeProgress(60, undefined).collections, 0)
  assert.equal(badgeProgress(60, 2.7).collections, 2)
  assert.equal(badgeProgress(60, -1).collections, 0)
})

test("formatKg switches to tonnes at 1000kg", () => {
  assert.equal(formatKg(0), "0 kg")
  assert.equal(formatKg(840), "840 kg")
  assert.equal(formatKg(999), "999 kg")
  assert.equal(formatKg(1000), "1.0 t")
  assert.equal(formatKg(1250), "1.3 t")
  assert.equal(formatKg(12000), "12 t")
})

test("badgeSummary reads naturally for a new and an established household", () => {
  assert.match(badgeSummary(0, 0), /no collections yet/)
  assert.equal(badgeSummary(60, 1), "Silver recycler — 60 kg recycled over 1 collection")
  assert.equal(badgeSummary(250, 4), "Gold recycler — 250 kg recycled over 4 collections")
})

test("every tier is reachable and ordered by threshold", () => {
  const floors = BADGE_TIERS.map(t => t.minKg)
  assert.deepEqual(floors, [...floors].sort((a, b) => a - b))
  assert.equal(BADGE_TIERS[0].minKg, 0)
  for (const tier of BADGE_TIERS) {
    assert.equal(badgeForKg(tier.minKg).key, tier.key)
    assert.ok(tier.className.startsWith("badge-"))
  }
})
