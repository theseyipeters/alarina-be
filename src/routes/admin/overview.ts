import { Router } from 'express'
import { env } from '../../config/env.js'
import { dbReady } from '../../db/connect.js'
import { todayInLagos } from '../../lib/dates.js'
import { paystackConfigured } from '../../lib/paystack.js'
import { Contribution } from '../../models/contribution.js'
import { Couple } from '../../models/couple.js'
import { GiftUnlock } from '../../models/giftUnlock.js'
import { attendingExpr, replyKindExpr, Rsvp } from '../../models/rsvp.js'
import { User } from '../../models/user.js'
import { Wedding } from '../../models/wedding.js'
import { byLagosDay, coupleLabel, emptyKinds, lastDays, paymentLines } from './shared.js'

export const adminOverviewRouter = Router()

const DAYS = 30

type DayCount = { _id: string; n: number }

/** Fills in the days that had nothing, so every series has one point per day. */
const series = (days: string[], rows: DayCount[]) => {
  const map = new Map(rows.map((r) => [r._id, r.n]))
  return days.map((day) => ({ day, value: map.get(day) ?? 0 }))
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Everything on the admin home page in one request: headline numbers, 30-day trends, what's
// coming up, the latest sign-ups, and whether the server's integrations are set up.
adminOverviewRouter.get('/overview', async (_req, res) => {
  const days = lastDays(DAYS)
  const since = new Date(`${days[0]}T00:00:00+01:00`)
  const today = todayInLagos()

  const [
    couples,
    users,
    suspended,
    weddingStatus,
    rsvpGroups,
    giftKinds,
    giftTotals,
    unlockTotals,
    pending,
    signupsByDay,
    publishedByDay,
    rsvpsByDay,
    giftsByDay,
    unlocksByDay,
    upcoming,
    recentCouples,
  ] = await Promise.all([
    Couple.countDocuments(),
    User.countDocuments(),
    Couple.countDocuments({ suspendedAt: { $type: 'date' } }),
    Wedding.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Rsvp.aggregate<{ _id: 'attending' | 'declined' | 'rejected'; n: number }>([{ $group: { _id: replyKindExpr, n: { $sum: 1 } } }]),
    Contribution.aggregate<{ _id: 'cash' | 'aso_ebi' | 'wishlist'; amount: number; count: number }>([
      { $match: { status: 'success' } },
      ...paymentLines,
      { $group: { _id: '$lines.kind', amount: { $sum: '$lines.amount' }, count: { $sum: 1 } } },
    ]),
    Contribution.aggregate<{ amount: number; fees: number; count: number; weddings: unknown[] }>([
      { $match: { status: 'success' } },
      { $group: { _id: null, amount: { $sum: '$amount' }, fees: { $sum: '$fee' }, count: { $sum: 1 }, weddings: { $addToSet: '$weddingId' } } },
    ]),
    GiftUnlock.aggregate<{ _id: boolean; revenue: number; count: number }>([
      { $match: { status: 'success' } },
      { $group: { _id: { $gt: ['$grantedBy', null] }, revenue: { $sum: '$charge' }, count: { $sum: 1 } } },
    ]),
    Promise.all([Contribution.countDocuments({ status: 'pending' }), GiftUnlock.countDocuments({ status: 'pending' })]),
    Couple.aggregate<DayCount>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: byLagosDay('createdAt'), n: { $sum: 1 } } },
    ]),
    Wedding.aggregate<DayCount>([
      { $match: { publishedAt: { $gte: since } } },
      { $group: { _id: byLagosDay('publishedAt'), n: { $sum: 1 } } },
    ]),
    Rsvp.aggregate<DayCount>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: byLagosDay('createdAt'), n: { $sum: 1 } } },
    ]),
    Contribution.aggregate<DayCount>([
      { $match: { status: 'success', paidAt: { $gte: since } } },
      { $group: { _id: byLagosDay('paidAt'), n: { $sum: '$amount' } } },
    ]),
    GiftUnlock.aggregate<DayCount>([
      { $match: { status: 'success', paidAt: { $gte: since }, charge: { $gt: 0 } } },
      { $group: { _id: byLagosDay('paidAt'), n: { $sum: '$charge' } } },
    ]),
    Wedding.find({ status: 'published', date: { $gte: today, $lte: addDays(today, 30) } })
      .sort({ date: 1 })
      .limit(8)
      .select('coupleId partnerOneName partnerTwoName date venueName slug'),
    Couple.find().sort({ createdAt: -1 }).limit(6).populate<{ members: { name: string; email: string }[] }>('members', 'name email'),
  ])

  const kinds = emptyKinds()
  for (const k of giftKinds) kinds[k._id] = { amount: k.amount, count: k.count }

  const upcomingIds = upcoming.map((w) => w._id)
  const [upcomingRsvps, recentWeddings] = await Promise.all([
    Rsvp.aggregate<{ _id: unknown; yes: number; total: number }>([
      { $match: { weddingId: { $in: upcomingIds } } },
      { $group: { _id: '$weddingId', yes: { $sum: attendingExpr }, total: { $sum: 1 } } },
    ]),
    Wedding.find({ coupleId: { $in: recentCouples.map((c) => c._id) } }).select('coupleId partnerOneName partnerTwoName status'),
  ])
  const rsvpsFor = new Map(upcomingRsvps.map((r) => [String(r._id), r]))
  const weddingFor = new Map(recentWeddings.map((w) => [String(w.coupleId), w]))

  const paid = unlockTotals.find((u) => !u._id)
  const comped = unlockTotals.find((u) => u._id)
  const gifts = giftTotals[0]
  const secret = env.PAYSTACK_SECRET_KEY

  res.json({
    totals: {
      couples,
      users,
      suspended,
      weddings: {
        draft: weddingStatus.find((s) => s._id === 'draft')?.n ?? 0,
        published: weddingStatus.find((s) => s._id === 'published')?.n ?? 0,
      },
      rsvps: {
        attending: rsvpGroups.find((r) => r._id === 'attending')?.n ?? 0,
        declined: rsvpGroups.find((r) => r._id === 'declined')?.n ?? 0,
        rejected: rsvpGroups.find((r) => r._id === 'rejected')?.n ?? 0,
      },
      gifts: {
        amount: gifts?.amount ?? 0,
        fees: gifts?.fees ?? 0,
        count: gifts?.count ?? 0,
        weddings: gifts?.weddings.length ?? 0,
        byKind: kinds,
      },
      unlocks: { paid: paid?.count ?? 0, revenue: paid?.revenue ?? 0, comped: comped?.count ?? 0 },
      pendingPayments: pending[0] + pending[1],
    },
    trends: {
      days: DAYS,
      signups: series(days, signupsByDay),
      published: series(days, publishedByDay),
      rsvps: series(days, rsvpsByDay),
      gifts: series(days, giftsByDay),
      unlockRevenue: series(days, unlocksByDay),
    },
    upcoming: upcoming.map((w) => ({
      coupleId: String(w.coupleId),
      names: coupleLabel(w),
      date: w.date,
      venueName: w.venueName ?? null,
      slug: w.slug ?? null,
      attending: rsvpsFor.get(String(w._id))?.yes ?? 0,
      replies: rsvpsFor.get(String(w._id))?.total ?? 0,
    })),
    recent: recentCouples.map((c) => {
      const w = weddingFor.get(String(c._id))
      return {
        id: String(c._id),
        createdAt: c.createdAt,
        names: coupleLabel(w),
        status: c.suspendedAt ? 'suspended' : (w?.status ?? 'no_wedding'),
        members: c.members.map((m) => ({ name: m.name, email: m.email })),
      }
    }),
    system: {
      db: dbReady(),
      paystack: {
        configured: paystackConfigured(),
        mode: secret ? (secret.startsWith('sk_live_') ? 'live' : 'test') : null,
        feesConfirmed: env.PAYSTACK_FEES_CONFIRMED,
      },
      email: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
      environment: env.NODE_ENV,
    },
  })
})
