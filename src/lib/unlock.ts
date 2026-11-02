import type { HydratedDocument } from 'mongoose'
import { Wedding } from '../models/wedding.js'
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
