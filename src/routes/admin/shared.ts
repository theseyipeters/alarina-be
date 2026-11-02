import { isValidObjectId, Types, type PipelineStage } from 'mongoose'
import { z } from 'zod'
import { HttpError } from '../../lib/httpError.js'

export const PAGE_SIZE = 25

export const pageQuery = z.coerce.number().int().min(1).max(10_000).catch(1)

export const paginate = (page: number) => ({ skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE })

/** Text from a search box, safe to use inside a regular expression. */
export const searchPattern = (q: string) => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

export function objectId(value: unknown, what = 'record') {
  if (typeof value !== 'string' || !isValidObjectId(value)) throw new HttpError(404, `We couldn’t find that ${what}`, 'not_found')
  return new Types.ObjectId(value)
}

export const coupleLabel = (w?: { partnerOneName?: string | null; partnerTwoName?: string | null } | null) =>
  [w?.partnerOneName, w?.partnerTwoName].filter(Boolean).join(' & ')

/** Why staff are doing something to a couple's account. Kept in the audit log. */
export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Say why, in a few words').max(500) })

/**
 * Pipeline stages that turn successful payments into one row per line. Payments from before
 * baskets have no lines and count as one cash gift of their amount (as `linesOf` does).
 */
export const paymentLines: PipelineStage[] = [
  {
    $project: {
      weddingId: 1,
      paidAt: 1,
      fee: 1,
      lines: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$lines', []] } }, 0] },
          '$lines',
          [{ kind: 'cash', amount: '$amount' }],
        ],
      },
    },
  },
  { $unwind: '$lines' },
]

export type KindTotals = Record<'cash' | 'aso_ebi' | 'wishlist', { amount: number; count: number }>

export const emptyKinds = (): KindTotals => ({
  cash: { amount: 0, count: 0 },
  aso_ebi: { amount: 0, count: 0 },
  wishlist: { amount: 0, count: 0 },
})

/** Lagos calendar days from `days - 1` days ago to today, as YYYY-MM-DD. */
export function lastDays(days: number) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' })
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(fmt.format(new Date(Date.now() - i * 86_400_000)))
  return out
}

/** Groups by Lagos calendar day of `field`. */
export const byLagosDay = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'Africa/Lagos' } })
