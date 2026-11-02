import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/httpError.js'
import { paystackConfigured, verifyTransaction } from '../../lib/paystack.js'
import { settle, settleGift } from '../../lib/settle.js'
import { applyUnlock } from '../../lib/unlock.js'
import { Contribution, linesOf } from '../../models/contribution.js'
import { GiftUnlock } from '../../models/giftUnlock.js'
import { Wedding } from '../../models/wedding.js'
import { coupleLabel, objectId, PAGE_SIZE, pageQuery, paginate, searchPattern } from './shared.js'

// Every payment through Alárinà: guests' gifts to couples, and couples' unlock fees to Alárinà.
export const adminPaymentsRouter = Router()

const STATUSES = ['all', 'pending', 'success', 'failed', 'abandoned'] as const

const listQuery = z.object({
  q: z.string().trim().max(100).catch(''),
  status: z.enum(STATUSES).catch('all'),
  kind: z.enum(['all', 'cash', 'aso_ebi', 'wishlist']).catch('all'),
  // Unlocks only: paid by the couple, or granted by staff.
  source: z.enum(['all', 'paid', 'comp']).catch('all'),
  page: pageQuery,
})

/** Couple names for a set of weddings, to label each payment. */
async function weddingLabels(ids: Types.ObjectId[]) {
  const weddings = await Wedding.find({ _id: { $in: ids } }).select('coupleId partnerOneName partnerTwoName slug')
  return new Map(weddings.map((w) => [String(w._id), { coupleId: String(w.coupleId), names: coupleLabel(w), slug: w.slug ?? null }]))
}

adminPaymentsRouter.get('/payments/gifts', async (req, res) => {
  const { q, status, kind, page } = listQuery.parse(req.query)
  const filter: Record<string, unknown> = {}
  const and: Record<string, unknown>[] = []
  if (status !== 'all') filter.status = status
  // Payments from before baskets have no lines and are cash.
  if (kind === 'cash') and.push({ $or: [{ lines: { $exists: false } }, { lines: { $size: 0 } }, { 'lines.kind': 'cash' }] })
  else if (kind !== 'all') filter['lines.kind'] = kind
  if (q) {
    const re = searchPattern(q)
    const weddings = await Wedding.find({ $or: [{ partnerOneName: re }, { partnerTwoName: re }, { slug: re }] }).select('_id')
    and.push({ $or: [{ guestName: re }, { guestEmail: re }, { reference: re }, { weddingId: { $in: weddings.map((w) => w._id) } }] })
  }
  if (and.length) filter.$and = and

  const { skip, limit } = paginate(page)
  const [items, total, sums] = await Promise.all([
    Contribution.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Contribution.countDocuments(filter),
    Contribution.aggregate<{ _id: string; amount: number; fee: number; count: number }>([
      { $match: filter },
      { $group: { _id: '$status', amount: { $sum: '$amount' }, fee: { $sum: '$fee' }, count: { $sum: 1 } } },
    ]),
  ])
  const labels = await weddingLabels(items.map((p) => p.weddingId))
  const ok = sums.find((s) => s._id === 'success')

  res.json({
    items: items.map((p) => ({
      id: String(p._id),
      reference: p.reference,
      wedding: labels.get(String(p.weddingId)) ?? null,
      guestName: p.guestName,
      guestEmail: p.guestEmail,
      guestPhone: p.guestPhone ?? null,
      lines: linesOf(p).map((l) => ({
        kind: l.kind,
        amount: l.amount,
        itemName: l.itemName ?? null,
        quantity: l.quantity ?? null,
        unit: l.unit ?? null,
      })),
      amount: p.amount,
      fee: p.fee,
      charge: p.charge,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    summary: { received: ok?.amount ?? 0, fees: ok?.fee ?? 0, succeeded: ok?.count ?? 0 },
  })
})

adminPaymentsRouter.get('/payments/unlocks', async (req, res) => {
  const { q, status, source, page } = listQuery.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (status !== 'all') filter.status = status
  if (source === 'paid') filter.grantedBy = null
  if (source === 'comp') filter.grantedBy = { $ne: null }
  if (q) {
    const re = searchPattern(q)
    const weddings = await Wedding.find({ $or: [{ partnerOneName: re }, { partnerTwoName: re }, { slug: re }] }).select('_id')
    filter.$or = [{ reference: re }, { weddingId: { $in: weddings.map((w) => w._id) } }]
  }

  const { skip, limit } = paginate(page)
  const [items, total, sums] = await Promise.all([
    GiftUnlock.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate<{ grantedBy: { name: string } | null }>('grantedBy', 'name'),
    GiftUnlock.countDocuments(filter),
    GiftUnlock.aggregate<{ revenue: number; count: number }>([
      { $match: { ...filter, status: 'success' } },
      { $group: { _id: null, revenue: { $sum: '$charge' }, count: { $sum: 1 } } },
    ]),
  ])
  const labels = await weddingLabels(items.map((u) => u.weddingId))

  res.json({
    items: items.map((u) => ({
      id: String(u._id),
      reference: u.reference,
      wedding: labels.get(String(u.weddingId)) ?? null,
      charge: u.charge,
      status: u.status,
      comp: Boolean(u.grantedBy),
      grantedBy: u.grantedBy?.name ?? null,
      note: u.note ?? null,
      createdAt: u.createdAt,
      paidAt: u.paidAt ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    summary: { revenue: sums[0]?.revenue ?? 0, succeeded: sums[0]?.count ?? 0 },
  })
})

const typeParam = z.enum(['gifts', 'unlocks'])

// Asks Paystack again about a payment that didn't settle (a missed webhook, a guest who closed the
// tab), and applies the answer the same way the webhook would. A success is never undone.
adminPaymentsRouter.post('/payments/:type/:id/recheck', async (req, res) => {
  const type = typeParam.parse(req.params.type)
  const id = objectId(req.params.id, 'payment')
  if (!paystackConfigured()) throw new HttpError(409, 'Paystack isn’t set up on this server', 'payments_not_configured')

  const payment = type === 'gifts' ? await Contribution.findById(id) : await GiftUnlock.findById(id)
  if (!payment) throw new HttpError(404, 'We couldn’t find that payment', 'not_found')
  if (payment.status === 'success') throw new HttpError(409, 'This payment has already succeeded', 'already_settled')
  if (payment.reference.startsWith('alr_comp_')) throw new HttpError(409, 'Granted unlocks have no payment to check', 'not_a_payment')

  const before = payment.status
  const tx = await verifyTransaction(payment.reference)
  await (type === 'gifts' ? settleGift(payment, tx) : settle(payment, tx))
  if (type === 'unlocks') await applyUnlock(payment as InstanceType<typeof GiftUnlock>)

  const wedding = await Wedding.findById(payment.weddingId).select('coupleId partnerOneName partnerTwoName')
  await audit(req, 'payment.rechecked', {
    coupleId: wedding?.coupleId ?? null,
    targetType: type === 'gifts' ? 'payment' : 'unlock',
    targetId: payment._id,
    targetLabel: payment.reference,
    meta: { before, after: payment.status, paystack: tx.status, couple: coupleLabel(wedding) },
  })
  res.json({ status: payment.status, paystackStatus: tx.status, changed: before !== payment.status })
})
