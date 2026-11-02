// Paystack's local (Nigerian) card pricing: 1.5% + ₦100, the ₦100 waived under ₦2,500, and the
// total fee capped at ₦2,000. Guests pay the fee on top, so the couple receives exactly the
// amount the guest chose. Check this against the account's pricing before setting
// PAYSTACK_FEES_CONFIRMED=true. All amounts are in kobo.

const PERCENT = 0.015
const FLAT = 100_00
const FLAT_WAIVED_UNDER = 2_500_00
const CAP = 2_000_00

export const MIN_GIFT = 1_000_00
export const MAX_GIFT = 5_000_000_00

/** What Paystack deducts from a charge of this size. */
export function paystackFee(charge: number) {
  const flat = charge >= FLAT_WAIVED_UNDER ? FLAT : 0
  return Math.min(Math.ceil(charge * PERCENT) + flat, CAP)
}

/** The smallest charge that leaves the couple with at least `net` after Paystack's fee. */
export function grossUp(net: number) {
  const candidates = [Math.ceil(net / (1 - PERCENT)), Math.ceil((net + FLAT) / (1 - PERCENT)), net + CAP]
  let charge = Math.min(...candidates.filter((c) => c - paystackFee(c) >= net))
  while (charge - 1 - paystackFee(charge - 1) >= net) charge -= 1
  return { charge, fee: charge - net }
}
