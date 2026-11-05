import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { PipelineStage, Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/httpError.js'
import { applyUnlock, giftsClosed } from '../../lib/unlock.js'
import { AuditLog } from '../../models/auditLog.js'
import { Contribution, linesOf } from '../../models/contribution.js'
import { Couple } from '../../models/couple.js'
import { GiftUnlock } from '../../models/giftUnlock.js'
import { Invite } from '../../models/invite.js'
import { attendingExpr, replyKind, Rsvp } from '../../models/rsvp.js'
import { Session } from '../../models/session.js'
import { User } from '../../models/user.js'
import { Wedding } from '../../models/wedding.js'
import { auditDto } from './audit.js'
import {
  coupleLabel,
  emptyKinds,
  objectId,
  PAGE_SIZE,
  pageQuery,
  paginate,
  paymentLines,
  reasonBody,
  searchPattern,
} from './shared.js'

export const adminCouplesRouter = Router()

const STATUSES = ['all', 'draft', 'published', 'no_wedding', 'suspended', 'unlocked'] as const
const SORTS = ['newest', 'oldest', 'wedding_date'] as const

const listQuery = z.object({
  q: z.string().trim().max(100).catch(''),
  status: z.enum(STATUSES).catch('all'),
  sort: z.enum(SORTS).catch('newest'),
  page: pageQuery,
})

/** Couples joined with their members and wedding, filtered the way the list asks. */
function couplesPipeline({ q, status, sort }: Omit<z.infer<typeof listQuery>, 'page'>): PipelineStage[] {
  const match: Record<string, unknown> = {}
  if (status === 'suspended') match.suspendedAt = { $type: 'date' }
  if (status === 'draft' || status === 'published') match['wedding.status'] = status
  if (status === 'no_wedding') match.wedding = null
  if (status === 'unlocked') match['wedding.giftsUnlockedAt'] = { $type: 'date' }
  if (q) {
    const re = searchPattern(q)
    match.$or = [
      { 'users.name': re },
      { 'users.email': re },
      { 'wedding.partnerOneName': re },
      { 'wedding.partnerTwoName': re },
      { 'wedding.slug': re },
    ]
  }
  const order: Record<string, 1 | -1> =
    sort === 'oldest' ? { createdAt: 1 } : sort === 'wedding_date' ? { hasDate: -1, 'wedding.date': 1 } : { createdAt: -1 }

  return [
    { $lookup: { from: 'users', localField: 'members', foreignField: '_id', as: 'users', pipeline: [{ $project: { name: 1, email: 1 } }] } },
    {
      $lookup: {
        from: 'weddings',
        localField: '_id',
        foreignField: 'coupleId',
        as: 'wedding',
        pipeline: [
          {
            $project: {
              partnerOneName: 1,
              partnerTwoName: 1,
              date: 1,
              slug: 1,
              status: 1,
              publishedAt: 1,
              giftsUnlockedAt: 1,
              venueName: 1,
            },
          },
        ],
      },
    },
    { $set: { wedding: { $ifNull: [{ $first: '$wedding' }, null] } } },
    { $match: match },
    // Soonest wedding first, upcoming ones only; couples with no date go last.
    ...(sort === 'wedding_date'
      ? [{ $set: { hasDate: { $cond: [{ $gte: ['$wedding.date', new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())] }, 1, 0] } } }]
      : []),
    { $sort: order },
  ]
}

type ListedCouple = {
  _id: Types.ObjectId
  createdAt: Date
  suspendedAt?: Date
  users: { _id: Types.ObjectId; name: string; email: string }[]
  wedding: {
    _id: Types.ObjectId
    partnerOneName?: string
    partnerTwoName?: string
    date?: string
    slug?: string
    status: 'draft' | 'published'
    publishedAt?: Date
    giftsUnlockedAt?: Date
    venueName?: string
  } | null
}

/** Reply counts and gift totals for a page of couples, by wedding id. */
async function statsFor(weddingIds: Types.ObjectId[]) {
  const [rsvps, gifts] = await Promise.all([
    Rsvp.aggregate<{ _id: Types.ObjectId; attending: number; total: number }>([
      { $match: { weddingId: { $in: weddingIds } } },
      { $group: { _id: '$weddingId', attending: { $sum: attendingExpr }, total: { $sum: 1 } } },
    ]),
    Contribution.aggregate<{ _id: Types.ObjectId; amount: number; count: number }>([
      { $match: { weddingId: { $in: weddingIds }, status: 'success' } },
      { $group: { _id: '$weddingId', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ])
  return {
    rsvps: new Map(rsvps.map((r) => [String(r._id), r])),
    gifts: new Map(gifts.map((g) => [String(g._id), g])),
  }
}

const listedDto = (c: ListedCouple, stats: Awaited<ReturnType<typeof statsFor>>) => {
  const w = c.wedding
  const r = w && stats.rsvps.get(String(w._id))
  const g = w && stats.gifts.get(String(w._id))
  return {
    id: String(c._id),
    createdAt: c.createdAt,
    suspended: Boolean(c.suspendedAt),
    members: c.users.map((u) => ({ name: u.name, email: u.email })),
    wedding: w
      ? {
          names: coupleLabel(w),
          date: w.date ?? null,
          slug: w.slug ?? null,
          status: w.status,
          venueName: w.venueName ?? null,
          giftsUnlocked: Boolean(w.giftsUnlockedAt),
        }
      : null,
    replies: { attending: r?.attending ?? 0, total: r?.total ?? 0 },
    gifts: { amount: g?.amount ?? 0, count: g?.count ?? 0 },
  }
}

adminCouplesRouter.get('/couples', async (req, res) => {
  const { page, ...filters } = listQuery.parse(req.query)
  const { skip, limit } = paginate(page)
  const [result] = await Couple.aggregate<{ items: ListedCouple[]; total: { n: number }[] }>([
    ...couplesPipeline(filters),
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ])
  const items = result?.items ?? []
  const stats = await statsFor(items.flatMap((c) => (c.wedding ? [c.wedding._id] : [])))
  res.json({ items: items.map((c) => listedDto(c, stats)), total: result?.total[0]?.n ?? 0, page, pageSize: PAGE_SIZE })
})

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // Quote everything, and stop spreadsheets reading a leading =, +, - or @ as a formula.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}

// The same list as a spreadsheet, every page at once, for reporting.
adminCouplesRouter.get('/couples/export.csv', async (req, res) => {
  const filters = listQuery.omit({ page: true }).parse(req.query)
  const items = await Couple.aggregate<ListedCouple>(couplesPipeline(filters))
  const stats = await statsFor(items.flatMap((c) => (c.wedding ? [c.wedding._id] : [])))
  const header = ['Couple', 'Members', 'Emails', 'Wedding date', 'Venue', 'Status', 'Gifts unlocked', 'Replies', 'Attending', 'Gifts received (NGN)', 'Joined', 'Suspended']
  const rows = items.map((c) => {
    const d = listedDto(c, stats)
    return [
      d.wedding?.names ?? '',
      d.members.map((m) => m.name).join('; '),
      d.members.map((m) => m.email).join('; '),
      d.wedding?.date ?? '',
      d.wedding?.venueName ?? '',
      d.wedding?.status ?? 'no wedding',
      d.wedding?.giftsUnlocked ? 'yes' : 'no',
      d.replies.total,
      d.replies.attending,
      (d.gifts.amount / 100).toFixed(2),
      d.createdAt.toISOString().slice(0, 10),
      d.suspended ? 'yes' : 'no',
    ]
  })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="alarina-couples-${new Date().toISOString().slice(0, 10)}.csv"`)
  // A byte-order mark, so Excel reads the names' accents as UTF-8.
  res.send(`\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`)
})

async function findCouple(id: unknown) {
  const couple = await Couple.findById(objectId(id, 'couple'))
  if (!couple) throw new HttpError(404, 'We couldn’t find that couple', 'not_found')
  return couple
}

// Everything staff need to help one couple: who they are, their wedding, replies, payments and history.
adminCouplesRouter.get('/couples/:id', async (req, res) => {
  const couple = await findCouple(req.params.id)
  const [members, wedding, invite, history] = await Promise.all([
    User.find({ _id: { $in: couple.members } }).sort({ createdAt: 1 }),
    Wedding.findOne({ coupleId: couple._id }),
    Invite.findOne({ coupleId: couple._id, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }),
    AuditLog.find({ coupleId: couple._id }).sort({ createdAt: -1 }).limit(50),
  ])

  const sessions = await Session.aggregate<{ _id: Types.ObjectId; n: number; last: Date }>([
    { $match: { userId: { $in: couple.members }, expiresAt: { $gt: new Date() } } },
    { $group: { _id: '$userId', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ])
  const sessionsFor = new Map(sessions.map((s) => [String(s._id), s]))

  const [rsvps, payments, unlocks, kindRows] = wedding
    ? await Promise.all([
        Rsvp.find({ weddingId: wedding._id }).sort({ createdAt: -1 }).limit(500),
        Contribution.find({ weddingId: wedding._id }).sort({ createdAt: -1 }).limit(200),
        GiftUnlock.find({ weddingId: wedding._id }).sort({ createdAt: -1 }).populate<{ grantedBy: { name: string } | null }>('grantedBy', 'name'),
        Contribution.aggregate<{ _id: 'cash' | 'aso_ebi' | 'wishlist'; amount: number; count: number }>([
          { $match: { weddingId: wedding._id, status: 'success' } },
          ...paymentLines,
          { $group: { _id: '$lines.kind', amount: { $sum: '$lines.amount' }, count: { $sum: 1 } } },
        ]),
      ])
    : [[], [], [], []]

  const byKind = emptyKinds()
  for (const k of kindRows) byKind[k._id] = { amount: k.amount, count: k.count }
  const sideName = new Map(members.map((m) => [String(m._id), m.name]))

  res.json({
    couple: {
      id: String(couple._id),
      createdAt: couple.createdAt,
      suspendedAt: couple.suspendedAt ?? null,
      suspendedReason: couple.suspendedReason ?? null,
      members: members.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
        createdAt: m.createdAt,
        activeSessions: sessionsFor.get(String(m._id))?.n ?? 0,
        lastSignInAt: sessionsFor.get(String(m._id))?.last ?? null,
      })),
      pendingInvite: invite ? { email: invite.email ?? null, expiresAt: invite.expiresAt } : null,
    },
    wedding: wedding
      ? {
          id: String(wedding._id),
          names: coupleLabel(wedding),
          partnerOneName: wedding.partnerOneName ?? null,
          partnerTwoName: wedding.partnerTwoName ?? null,
          date: wedding.date ?? null,
          startTime: wedding.startTime ?? null,
          venueName: wedding.venueName ?? null,
          venueAddress: wedding.venueAddress ?? null,
          status: wedding.status,
          slug: wedding.slug ?? null,
          inviteUrl: wedding.slug ? `${env.CLIENT_ORIGIN}/invite/${wedding.slug}` : null,
          publishedAt: wedding.publishedAt ?? null,
          setupCompletedAt: wedding.setupCompletedAt ?? null,
          checkpoint: wedding.checkpoint,
          events: wedding.events.length,
          template: wedding.template,
          palette: wedding.palette,
          giftsUnlockedAt: wedding.giftsUnlockedAt ?? null,
          giftsClosed: giftsClosed(wedding),
          switches: { cash: wedding.giftsEnabled, asoEbi: wedding.asoEbiEnabled, wishlist: wedding.wishlistEnabled },
          items: { asoEbi: wedding.asoEbiItems.length, wishlist: wedding.wishlistItems.length },
          payout: wedding.payout
            ? {
                bankName: wedding.payout.bankName,
                accountName: wedding.payout.accountName,
                accountLast4: wedding.payout.accountLast4,
                verifiedAt: wedding.payout.verifiedAt,
              }
            : null,
          createdAt: wedding.createdAt,
          updatedAt: wedding.updatedAt,
        }
      : null,
    stats: {
      replies: {
        attending: rsvps.filter((r) => replyKind(r) === 'attending').length,
        declined: rsvps.filter((r) => replyKind(r) === 'declined').length,
        rejected: rsvps.filter((r) => replyKind(r) === 'rejected').length,
      },
      gifts: byKind,
    },
    rsvps: rsvps.map((r) => ({
      id: String(r._id),
      name: r.name,
      email: r.email,
      phone: r.phone,
      reply: replyKind(r),
      side: r.sideUserId ? (sideName.get(String(r.sideUserId)) ?? null) : null,
      createdAt: r.createdAt,
    })),
    payments: payments.map((p) => ({
      id: String(p._id),
      reference: p.reference,
      guestName: p.guestName,
      guestEmail: p.guestEmail,
      guestPhone: p.guestPhone ?? null,
      kinds: [...new Set(linesOf(p).map((l) => l.kind))],
      amount: p.amount,
      fee: p.fee,
      charge: p.charge,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt ?? null,
    })),
    unlocks: unlocks.map((u) => ({
      id: String(u._id),
      reference: u.reference,
      charge: u.charge,
      status: u.status,
      comp: Boolean(u.grantedBy),
      grantedBy: u.grantedBy?.name ?? null,
      note: u.note ?? null,
      createdAt: u.createdAt,
      paidAt: u.paidAt ?? null,
    })),
    history: history.map(auditDto),
  })
})

/** The couple's names for the activity log: from their wedding, or their own names before they've set one up. */
async function label(couple: { _id: Types.ObjectId; members: Types.ObjectId[] }) {
  const names = coupleLabel(await Wedding.findOne({ coupleId: couple._id }).select('partnerOneName partnerTwoName'))
  return names || (await User.find({ _id: { $in: couple.members } }).select('name')).map((u) => u.name).join(' & ')
}

// Suspending ends every session straight away and takes the invitation offline.
adminCouplesRouter.post('/couples/:id/suspend', async (req, res) => {
  const { reason } = reasonBody.parse(req.body)
  const couple = await findCouple(req.params.id)
  if (couple.suspendedAt) throw new HttpError(409, 'This couple is already suspended', 'already_suspended')
  couple.suspendedAt = new Date()
  couple.suspendedReason = reason
  await couple.save()
  const { deletedCount } = await Session.deleteMany({ userId: { $in: couple.members } })
  await audit(req, 'couple.suspended', {
    coupleId: couple._id,
    targetType: 'couple',
    targetId: couple._id,
    targetLabel: await label(couple),
    reason,
    meta: { sessionsEnded: deletedCount },
  })
  res.json({ ok: true })
})

adminCouplesRouter.post('/couples/:id/restore', async (req, res) => {
  const { reason } = reasonBody.parse(req.body)
  const couple = await findCouple(req.params.id)
  if (!couple.suspendedAt) throw new HttpError(409, 'This couple isn’t suspended', 'not_suspended')
  couple.suspendedAt = undefined
  couple.suspendedReason = undefined
  await couple.save()
  await audit(req, 'couple.restored', { coupleId: couple._id, targetType: 'couple', targetId: couple._id, targetLabel: await label(couple), reason })
  res.json({ ok: true })
})

// Ends every session for both partners, such as when an account may have been taken over.
adminCouplesRouter.post('/couples/:id/signout', async (req, res) => {
  const { reason } = reasonBody.parse(req.body)
  const couple = await findCouple(req.params.id)
  const { deletedCount } = await Session.deleteMany({ userId: { $in: couple.members } })
  await audit(req, 'couple.signed_out', {
    coupleId: couple._id,
    targetType: 'couple',
    targetId: couple._id,
    targetLabel: await label(couple),
    reason,
    meta: { sessionsEnded: deletedCount },
  })
  res.json({ sessionsEnded: deletedCount })
})

async function coupleWedding(id: unknown) {
  const couple = await findCouple(id)
  const wedding = await Wedding.findOne({ coupleId: couple._id })
  if (!wedding) throw new HttpError(409, 'This couple hasn’t started their wedding yet', 'no_wedding')
  return { couple, wedding }
}

// Grants Gifts without the ₦5,000 payment. Recorded as an unlock with no charge, so revenue stays true.
adminCouplesRouter.post('/couples/:id/gifts/unlock', async (req, res) => {
  const { reason } = reasonBody.parse(req.body)
  const { couple, wedding } = await coupleWedding(req.params.id)
  if (wedding.giftsUnlockedAt) throw new HttpError(409, 'Gifts is already unlocked for this couple', 'already_unlocked')
  if (giftsClosed(wedding)) throw new HttpError(409, 'Their wedding has passed, so Gifts is closed', 'gifts_ended')

  const unlock = await GiftUnlock.create({
    weddingId: wedding._id,
    charge: 0,
    reference: `alr_comp_${randomBytes(12).toString('hex')}`,
    status: 'success',
    paidAt: new Date(),
    grantedBy: req.admin!.user._id,
    note: reason,
  })
  await applyUnlock(unlock)
  await audit(req, 'gifts.unlocked', { coupleId: couple._id, targetType: 'couple', targetId: couple._id, targetLabel: await label(couple), reason })
  res.json({ ok: true })
})

// Takes Gifts away again. Guests stop seeing gifts; what the couple received stays on record.
// A paid unlock isn't refunded here: refunds go through Paystack.
adminCouplesRouter.post('/couples/:id/gifts/lock', async (req, res) => {
  const { reason } = reasonBody.parse(req.body)
  const { couple, wedding } = await coupleWedding(req.params.id)
  if (!wedding.giftsUnlockedAt) throw new HttpError(409, 'Gifts is already locked for this couple', 'already_locked')
  // Retire the payments too, or the couple could replay one on the unlock page.
  await GiftUnlock.updateMany({ weddingId: wedding._id, status: 'success', revokedAt: null }, { $set: { revokedAt: new Date() } })
  await Wedding.updateOne({ _id: wedding._id }, { $unset: { giftsUnlockedAt: 1 } })
  await audit(req, 'gifts.locked', { coupleId: couple._id, targetType: 'couple', targetId: couple._id, targetLabel: await label(couple), reason })
  res.json({ ok: true })
})
