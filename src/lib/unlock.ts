import type { HydratedDocument } from 'mongoose'
import { Wedding } from '../models/wedding.js'
import { todayInLagos } from './dates.js'
import type { GiftUnlockDoc } from '../models/giftUnlock.js'

// Gifts (cash, aso-ebi and the wishlist) are free to set up but need a one-time payment from the
// couple before they can be used or shown to guests. In kobo. The ₦5,000 is charged exactly:
// Paystack's fee on it comes out of Alárinà's side.
export const GIFTS_UNLOCK_PRICE = 5_000_00

/** Marks the wedding unlocked once its payment has succeeded. Safe to call again. */
export async function applyUnlock(unlock: HydratedDocument<GiftUnlockDoc>) {
  if (unlock.status !== 'success') return
  await Wedding.updateOne(
    { _id: unlock.weddingId, giftsUnlockedAt: { $exists: false } },
    { $set: { giftsUnlockedAt: unlock.paidAt ?? new Date() } },
  )
}

// Gifts close to guests once the wedding day has passed (Lagos time). Raise the grace period to
// keep them open for a while longer. What the couple have received stays visible to them.
export const GIFTS_GRACE_DAYS = 0

/** The last day guests can give: the wedding day plus the grace period, or null if no date is set yet. */
export function giftsLastDay(wedding: { date?: string | null }) {
  if (!wedding.date) return null
  const day = new Date(`${wedding.date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + GIFTS_GRACE_DAYS)
  return day.toISOString().slice(0, 10)
}

export function giftsClosed(wedding: { date?: string | null }) {
  const last = giftsLastDay(wedding)
  return last !== null && todayInLagos() > last
}
