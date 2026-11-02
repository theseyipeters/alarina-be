import type { HydratedDocument } from 'mongoose'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import { paystackConfigured } from '../lib/paystack.js'
import { fundedByItem, MAX_WISH_PRICE_NAIRA, MAX_WISHLIST_ITEMS, MIN_WISH_PRICE_NAIRA } from '../lib/wishlist.js'
import { assertOwnImage, deleteImage } from '../lib/itemImages.js'
import { requireAuth } from '../middleware/auth.js'
import { Contribution, hasWishlist, type ContributionDoc } from '../models/contribution.js'
import { ownWedding } from './gifts.js'

// The couple's side of the wishlist: what's on it, switching it on, and what guests have paid.
export const wishlistRouter = Router()

wishlistRouter.use(requireAuth)

const itemInput = z.strictObject({
  // The id of an uploaded photo, or null for none.
  imageId: z.string().regex(/^[a-f0-9]{24}$/).nullable(),
  name: z.string().trim().min(1).max(80),
  // An empty description clears it.
  description: z.string().trim().max(300),
  price: z.number().int().min(MIN_WISH_PRICE_NAIRA).max(MAX_WISH_PRICE_NAIRA),
})

// One entry per wishlist line, so a basket with two wishlist items shows as two gifts.
const giftDtos = (c: HydratedDocument<ContributionDoc>) =>
  c.lines
    .filter((line) => line.kind === 'wishlist')
    .map((line, index) => ({
      id: `${String(c._id)}-${index}`,
      guestName: c.guestName,
      guestEmail: c.guestEmail,
      itemName: line.itemName ?? '',
      amount: line.amount,
      status: c.status,
      createdAt: c.createdAt,
      paidAt: c.paidAt ?? null,
    }))

wishlistRouter.get('/gifts/wishlist', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const [payments, funded] = await Promise.all([
    Contribution.find({ weddingId: wedding._id, ...hasWishlist }).sort({ createdAt: -1 }),
    fundedByItem(wedding._id),
  ])
  const gifts = payments.flatMap(giftDtos)
  const paid = gifts.filter((g) => g.status === 'success')

  res.json({
    configured: paystackConfigured(),
    feesConfirmed: env.PAYSTACK_FEES_CONFIRMED,
    enabled: wedding.wishlistEnabled,
    hasPayout: Boolean(wedding.payout),
    items: wedding.wishlistItems.map((item) => ({
      id: String(item._id),
      name: item.name,
      description: item.description ?? '',
      imageId: item.imageId ?? null,
      price: item.price,
      funded: Math.min(item.price, funded.get(String(item._id)) ?? 0),
    })),
    totals: { received: paid.reduce((sum, g) => sum + g.amount, 0), count: paid.length },
    // Abandoned checkouts are noise for the couple, so only real outcomes are listed.
    gifts: gifts.filter((g) => g.status !== 'abandoned'),
  })
})

wishlistRouter.post('/gifts/wishlist/items', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  if (wedding.wishlistItems.length >= MAX_WISHLIST_ITEMS) {
    throw new HttpError(409, `You can list up to ${MAX_WISHLIST_ITEMS} items`, 'too_many_items')
  }
  const input = itemInput.parse(req.body)
  if (input.imageId) await assertOwnImage(wedding._id, input.imageId)
  wedding.wishlistItems.push({ ...input, description: input.description || undefined, imageId: input.imageId ?? undefined, price: input.price * 100 })
  await wedding.save()
  res.status(201).json({ id: String(wedding.wishlistItems[wedding.wishlistItems.length - 1]!._id) })
})

const itemOf = (wedding: Awaited<ReturnType<typeof ownWedding>>, id: string) => {
  const item = wedding.wishlistItems.find((i) => String(i._id) === id)
  if (!item) throw new HttpError(404, 'We couldn’t find that item', 'item_not_found')
  return item
}

wishlistRouter.put('/gifts/wishlist/items/:id', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const item = itemOf(wedding, String(req.params.id))
  const input = itemInput.parse(req.body)
  if (input.imageId) await assertOwnImage(wedding._id, input.imageId)
  const oldImage = item.imageId
  // Gifts keep the name they were paid under, so editing only affects what guests see from now on.
  item.set({ ...input, description: input.description || undefined, imageId: input.imageId ?? undefined, price: input.price * 100 })
  await wedding.save()
  if (oldImage !== input.imageId) await deleteImage(oldImage)
  res.json({ ok: true })
})

wishlistRouter.delete('/gifts/wishlist/items/:id', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const item = itemOf(wedding, String(req.params.id))
  const oldImage = item.imageId
  item.deleteOne()
  await wedding.save()
  await deleteImage(oldImage)
  res.status(204).end()
})

const toggleInput = z.strictObject({ enabled: z.boolean() })

wishlistRouter.patch('/gifts/wishlist', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const { enabled } = toggleInput.parse(req.body)

  if (enabled) {
    if (!paystackConfigured()) {
      throw new HttpError(409, 'Payments aren’t set up on this server yet', 'payments_not_configured')
    }
    if (!env.PAYSTACK_FEES_CONFIRMED) {
      throw new HttpError(409, 'The wishlist can’t be switched on until payment fees are confirmed', 'fees_not_confirmed')
    }
    if (!wedding.payout) throw new HttpError(409, 'Add the account payments should go to first', 'no_payout_account')
    if (wedding.wishlistItems.length === 0) throw new HttpError(409, 'Add an item first', 'no_items')
  }

  wedding.wishlistEnabled = enabled
  await wedding.save()
  res.json({ enabled })
})
