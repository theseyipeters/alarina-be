import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { Router } from 'express'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { verifyTransaction } from '../lib/paystack.js'
import { settle, settleGift } from '../lib/settle.js'
import { applyUnlock } from '../lib/unlock.js'
import { Contribution } from '../models/contribution.js'
import { GiftUnlock } from '../models/giftUnlock.js'

// Paystack calls this server-to-server, so it sits outside the origin check and needs the raw
// body to verify the signature (HMAC-SHA512 of the body with the secret key).
export const webhooksRouter = Router()

function validSignature(raw: Buffer, signature: string | undefined) {
  if (!env.PAYSTACK_SECRET_KEY || !signature) return false
  const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

webhooksRouter.post('/paystack', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  const raw = req.body as Buffer
  if (!Buffer.isBuffer(raw) || !validSignature(raw, req.get('x-paystack-signature'))) {
    res.status(401).end()
    return
  }

  const event = JSON.parse(raw.toString('utf8')) as { event?: string; data?: { reference?: string } }
  const reference = event.data?.reference
  if (reference && (event.event === 'charge.success' || event.event === 'charge.failed')) {
    const gift = await Contribution.findOne({ reference })
    if (gift) {
      // Don't trust the event body for the outcome; ask Paystack directly.
      await settleGift(gift, await verifyTransaction(reference))
    } else {
      const unlock = await GiftUnlock.findOne({ reference })
      if (unlock) {
        await settle(unlock, await verifyTransaction(reference))
        await applyUnlock(unlock)
      } else {
        logger.warn({ reference }, 'Webhook for an unknown payment reference')
      }
    }
  }
  // Always 200 for a genuine event, so Paystack doesn't keep retrying ones we don't use.
  res.status(200).end()
})
