import type { HydratedDocument } from 'mongoose'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { ASO_EBI_UNITS, MAX_ITEMS, MAX_PRICE_NAIRA, MIN_PRICE_NAIRA } from '../lib/asoEbi.js'
import { HttpError } from '../lib/httpError.js'
import { paystackConfigured } from '../lib/paystack.js'
import { assertOwnImage, deleteImage } from '../lib/itemImages.js'
import { requireAuth } from '../middleware/auth.js'
import { requireGiftsUnlocked } from '../middleware/giftsUnlocked.js'
import { Contribution, hasAsoEbi, type ContributionDoc } from '../models/contribution.js'
import { ownWedding } from './gifts.js'

// The couple's side of aso-ebi: what's on offer, switching it on, and who has ordered.
export const asoEbiRouter = Router()

asoEbiRouter.use(requireAuth)
asoEbiRouter.use('/gifts', requireGiftsUnlocked)

const itemInput = z.strictObject({
  // The id of an uploaded photo, or null for none.
  imageId: z.string().regex(/^[a-f0-9]{24}$/).nullable(),
  name: z.string().trim().min(1).max(60),
  // An empty description clears it.
  description: z.string().trim().max(300),
  unit: z.enum(ASO_EBI_UNITS),
  price: z.number().int().min(MIN_PRICE_NAIRA).max(MAX_PRICE_NAIRA),
})

// One order per aso-ebi line, so a basket with two items shows as two orders.
const orderDtos = (c: HydratedDocument<ContributionDoc>) =>
  c.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.kind === 'aso_ebi')
    .map(({ line, index }) => ({
      id: `${String(c._id)}-${index}`,
      itemId: line.itemId ?? '',
      guestName: c.guestName,
      guestEmail: c.guestEmail,
      phone: c.guestPhone ?? '',
      itemName: line.itemName ?? '',
      unit: line.unit ?? '',
      quantity: line.quantity ?? 0,
      amount: line.amount,
      status: c.status,
      createdAt: c.createdAt,
      paidAt: c.paidAt ?? null,
    }))

asoEbiRouter.get('/gifts/aso-ebi', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const payments = await Contribution.find({ weddingId: wedding._id, ...hasAsoEbi }).sort({ createdAt: -1 })
  const orders = payments.flatMap(orderDtos)
  const paid = orders.filter((o) => o.status === 'success')

  res.json({
    configured: paystackConfigured(),
    feesConfirmed: env.PAYSTACK_FEES_CONFIRMED,
    enabled: wedding.asoEbiEnabled,
    hasPayout: Boolean(wedding.payout),
    items: wedding.asoEbiItems.map((item) => ({
      id: String(item._id),
      name: item.name,
      description: item.description ?? '',
      imageId: item.imageId ?? null,
      unit: item.unit,
      price: item.price,
      sold: paid.filter((o) => o.itemId === String(item._id)).reduce((sum, o) => sum + o.quantity, 0),
    })),
    totals: { received: paid.reduce((sum, o) => sum + o.amount, 0), count: paid.length },
    // Abandoned checkouts are noise for the couple, so only real outcomes are listed.
    orders: orders.filter((o) => o.status !== 'abandoned'),
  })
})

asoEbiRouter.post('/gifts/aso-ebi/items', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  if (wedding.asoEbiItems.length >= MAX_ITEMS) {
    throw new HttpError(409, `You can list up to ${MAX_ITEMS} items`, 'too_many_items')
  }
  const input = itemInput.parse(req.body)
  if (input.imageId) await assertOwnImage(wedding._id, input.imageId)
  wedding.asoEbiItems.push({ ...input, description: input.description || undefined, imageId: input.imageId ?? undefined, price: input.price * 100 })
  await wedding.save()
  res.status(201).json({ id: String(wedding.asoEbiItems[wedding.asoEbiItems.length - 1]!._id) })
})

const itemOf = (wedding: Awaited<ReturnType<typeof ownWedding>>, id: string) => {
  const item = wedding.asoEbiItems.find((i) => String(i._id) === id)
  if (!item) throw new HttpError(404, 'We couldn’t find that item', 'item_not_found')
  return item
}

asoEbiRouter.put('/gifts/aso-ebi/items/:id', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const item = itemOf(wedding, String(req.params.id))
  const input = itemInput.parse(req.body)
  if (input.imageId) await assertOwnImage(wedding._id, input.imageId)
  const oldImage = item.imageId
  // Orders keep the name and price they were placed at, so editing only affects new ones.
  item.set({ ...input, description: input.description || undefined, imageId: input.imageId ?? undefined, price: input.price * 100 })
  await wedding.save()
  if (oldImage !== input.imageId) await deleteImage(oldImage)
  res.json({ ok: true })
})

asoEbiRouter.delete('/gifts/aso-ebi/items/:id', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const item = itemOf(wedding, String(req.params.id))
  const oldImage = item.imageId
  item.deleteOne()
  await wedding.save()
  await deleteImage(oldImage)
  res.status(204).end()
})

const toggleInput = z.strictObject({ enabled: z.boolean() })

asoEbiRouter.patch('/gifts/aso-ebi', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const { enabled } = toggleInput.parse(req.body)

  if (enabled) {
    if (!paystackConfigured()) {
      throw new HttpError(409, 'Payments aren’t set up on this server yet', 'payments_not_configured')
    }
    if (!env.PAYSTACK_FEES_CONFIRMED) {
      throw new HttpError(409, 'Aso-ebi can’t be switched on until payment fees are confirmed', 'fees_not_confirmed')
    }
    if (!wedding.payout) throw new HttpError(409, 'Add the account payments should go to first', 'no_payout_account')
    if (wedding.asoEbiItems.length === 0) throw new HttpError(409, 'Add an item first', 'no_items')
  }

  wedding.asoEbiEnabled = enabled
  await wedding.save()
  res.json({ enabled })
})
