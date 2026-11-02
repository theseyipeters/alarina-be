import type { Types } from 'mongoose'
import { Contribution, hasWishlist } from '../models/contribution.js'

// The wishlist: the couple lists things they'd like with a price, and guests pay for all of an
// item or chip in towards it. Prices are whole naira in the API and kobo in the database.

export const MAX_WISHLIST_ITEMS = 30
export const MIN_WISH_PRICE_NAIRA = 500
export const MAX_WISH_PRICE_NAIRA = 2_000_000
// The smallest chip-in, in kobo. The last bit of an item can be less, so it can always be finished.
export const MIN_CONTRIBUTION = 500_00

/** Kobo paid so far towards each item, by item id. Only confirmed payments count. */
export async function fundedByItem(weddingId: Types.ObjectId) {
  const payments = await Contribution.find({ weddingId, status: 'success', ...hasWishlist })
  const funded = new Map<string, number>()
  for (const payment of payments) {
    for (const line of payment.lines) {
      if (line.kind === 'wishlist' && line.itemId) funded.set(line.itemId, (funded.get(line.itemId) ?? 0) + line.amount)
    }
  }
  return funded
}
