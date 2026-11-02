import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import { initializeTransaction, paystackConfigured, verifyTransaction } from '../lib/paystack.js'
import { settle } from '../lib/settle.js'
import { applyUnlock, giftsClosed, giftsLastDay, GIFTS_UNLOCK_PRICE } from '../lib/unlock.js'
import { requireAuth } from '../middleware/auth.js'
import { accountLookupLimiter } from '../middleware/rateLimit.js'
import { GiftUnlock } from '../models/giftUnlock.js'
import { Wedding } from '../models/wedding.js'
import { ownWedding } from './gifts.js'

// The one-time payment that opens Gifts for a couple. Mounted before the gift routes, which stay
// locked until this has succeeded.
export const unlockRouter = Router()

unlockRouter.use(requireAuth)

unlockRouter.get('/gifts/access', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  res.json({
    unlocked: Boolean(wedding.giftsUnlockedAt),
    price: GIFTS_UNLOCK_PRICE,
    configured: paystackConfigured(),
    // True once the wedding is over: guests can no longer give, and Gifts can't be unlocked.
    closed: giftsClosed(wedding),
    closedAfter: giftsLastDay(wedding),
  })
})

// Starts checkout. The money goes to Alárinà's own Paystack account (no subaccount).
unlockRouter.post('/gifts/unlock', accountLookupLimiter, async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  if (wedding.giftsUnlockedAt) throw new HttpError(409, 'Gifts is already unlocked', 'already_unlocked')
  if (giftsClosed(wedding)) throw new HttpError(409, 'Your wedding has passed, so Gifts is closed', 'gifts_ended')
  if (!paystackConfigured()) {
    throw new HttpError(409, 'Payments aren’t set up on this server yet', 'payments_not_configured')
  }

  const reference = `alr_unlock_${randomBytes(12).toString('hex')}`
  const unlock = await GiftUnlock.create({ weddingId: wedding._id, charge: GIFTS_UNLOCK_PRICE, reference })
  try {
    const checkout = await initializeTransaction({
      email: req.auth!.user.email,
      amount: GIFTS_UNLOCK_PRICE,
      reference,
      callback_url: `${env.CLIENT_ORIGIN}/app/gifts`,
      metadata: { weddingId: String(wedding._id), purpose: 'gifts_unlock' },
    })
    res.status(201).json({ checkoutUrl: checkout.authorization_url })
  } catch (err) {
    unlock.status = 'failed'
    await unlock.save()
    throw err
  }
})

const verifyInput = z.strictObject({ reference: z.string().min(1).max(100) })

// Where the couple lands after Paystack: confirm with Paystack directly, then unlock.
unlockRouter.post('/gifts/unlock/verify', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const { reference } = verifyInput.parse(req.body)
  const unlock = await GiftUnlock.findOne({ reference, weddingId: wedding._id })
  if (!unlock) throw new HttpError(404, 'We couldn’t find that payment', 'payment_not_found')

  if (unlock.status === 'pending') await settle(unlock, await verifyTransaction(reference))
  await applyUnlock(unlock)
  const fresh = await Wedding.findById(wedding._id).orFail()
  res.json({ status: unlock.status, unlocked: Boolean(fresh.giftsUnlockedAt) })
})
