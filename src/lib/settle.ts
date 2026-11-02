import { logger } from '../config/logger.js'
import { notifyGift } from './notify.js'
import type { VerifiedTransaction } from './paystack.js'

/**
 * Applies Paystack's view of a transaction to our record. Used by both the webhook and the
 * guest's return from checkout, so it's idempotent: a success is never downgraded, and the
 * amount must match what we asked Paystack to charge before anything counts as paid.
 */
/** Anything paid for through Paystack: a guest's gift or a couple's unlock fee. */
type Payment = {
  reference: string
  charge: number
  status: 'pending' | 'success' | 'failed' | 'abandoned'
  paidAt?: Date | null
  save(): Promise<unknown>
}

export async function settle<T extends Payment>(gift: T, tx: VerifiedTransaction): Promise<T> {
  if (gift.status === 'success') return gift

  if (tx.status === 'success') {
    if (tx.amount !== gift.charge || tx.currency !== 'NGN') {
      logger.warn({ reference: gift.reference, expected: gift.charge, got: tx.amount }, 'Gift amount mismatch')
      gift.status = 'failed'
    } else {
      gift.status = 'success'
      gift.paidAt = tx.paid_at ? new Date(tx.paid_at) : new Date()
    }
  } else if (tx.status === 'failed' || tx.status === 'abandoned') {
    gift.status = tx.status
  }
  await gift.save()
  return gift
}

/** Settles a guest's payment, and tells the couple when it's just gone through. */
export async function settleGift<T extends Payment & { _id: unknown }>(gift: T, tx: VerifiedTransaction): Promise<T> {
  const before = gift.status
  await settle(gift, tx)
  if (before !== 'success' && gift.status === 'success') notifyGift(gift)
  return gift
}
