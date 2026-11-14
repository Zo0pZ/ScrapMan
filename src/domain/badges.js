/* ScrapMan — household recycling badges.
 *
 * Homeowners are deliberately NOT rated. A public star average attached to someone's
 * home address is unfair (a household lists a broken fridge once, gets one grumpy
 * collector, and carries 2 stars forever) and it leaks a trust signal that collectors
 * never actually asked for. What collectors do care about is whether a household is a
 * real, repeat recycler.
 *
 * So the badge measures the one thing the platform can prove: how much scrap a household
 * has actually put into the recycling stream, summed from the verified collection
 * weights recorded in job_proofs (see supabase/migrations/006_*.sql). It goes up when
 * metal is genuinely collected, and it never goes down on somebody's opinion.
 *
 * Pure module: no DOM, no Supabase. The kg figure arrives from the household_badge RPC.
 */

/* Tiers are cumulative kilos recycled through ScrapMan. The thresholds are chosen so a
 * typical household clears Bronze on its first collection (a washing machine is ~35kg),
 * and Silver after a couple of clear-outs — enough that the badge visibly moves early,
 * which is the whole point of a progress signal. */
export const BADGE_TIERS = [
  { key: "bronze", label: "Bronze recycler", minKg: 0, className: "badge-bronze" },
  { key: "silver", label: "Silver recycler", minKg: 50, className: "badge-silver" },
  { key: "gold", label: "Gold recycler", minKg: 200, className: "badge-gold" },
  { key: "platinum", label: "Platinum recycler", minKg: 500, className: "badge-platinum" }
]

/* Coerce whatever came back from the database into a usable number. Postgres numeric
 * arrives as a string over PostgREST, and a null aggregate arrives as null. */
export function toKg(value) {
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/* The tier a household currently holds. Always returns a tier — 0kg is Bronze, so every
 * household has a badge from the moment it signs up. */
export function badgeForKg(totalKg) {
  const kg = toKg(totalKg)
  let tier = BADGE_TIERS[0]
  for (const candidate of BADGE_TIERS) {
    if (kg >= candidate.minKg) tier = candidate
  }
  return tier
}

/* The next tier up, or null at the top. */
export function nextBadge(totalKg) {
  const kg = toKg(totalKg)
  return BADGE_TIERS.find(t => t.minKg > kg) || null
}

/* Everything a progress bar needs in one object. `pct` is progress from the current
 * tier's floor to the next tier's floor, so it hits 0% on promotion rather than
 * measuring progress from zero every time (which makes higher tiers look stuck). */
export function badgeProgress(totalKg, collections) {
  const kg = toKg(totalKg)
  const tier = badgeForKg(kg)
  const next = nextBadge(kg)
  const count = Number.isFinite(collections) && collections > 0 ? Math.floor(collections) : 0

  if (!next) {
    return { kg, collections: count, tier, next: null, kgToNext: 0, pct: 100 }
  }

  const span = next.minKg - tier.minKg
  const done = kg - tier.minKg
  const pct = span > 0 ? Math.min(100, Math.max(0, Math.round((done / span) * 100))) : 0

  return {
    kg,
    collections: count,
    tier,
    next,
    kgToNext: Math.max(0, next.minKg - kg),
    pct
  }
}

/* "840 kg" below a tonne, "1.2 t" above it — the unit a scrap yard actually talks in. */
export function formatKg(value) {
  const kg = toKg(value)
  if (kg < 1000) return `${Math.round(kg)} kg`
  const tonnes = kg / 1000
  return `${tonnes >= 10 ? Math.round(tonnes) : tonnes.toFixed(1)} t`
}

/* One-line description used on job cards and the account screen, so a collector knows
 * what the badge means without a legend. */
export function badgeSummary(totalKg, collections) {
  const { tier, kg, collections: count } = badgeProgress(totalKg, collections)
  if (count === 0) return `${tier.label} — no collections yet`
  const jobs = count === 1 ? "1 collection" : `${count} collections`
  return `${tier.label} — ${formatKg(kg)} recycled over ${jobs}`
}
