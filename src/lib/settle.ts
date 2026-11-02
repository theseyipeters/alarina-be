import type { HydratedDocument } from 'mongoose'
import { logger } from '../config/logger.js'
import type { ContributionDoc } from '../models/contribution.js'
import type { VerifiedTransaction } from './paystack.js'

/**
 * Applies Paystack's view of a transaction to our record. Used by both the webhook and the
 * guest's return from checkout, so it's idempotent: a success is never downgraded, and the
 * amount must match what we asked Paystack to charge before anything counts as paid.
 */
export async function settle(gift: HydratedDocument<ContributionDoc>, tx: VerifiedTransaction) {
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
