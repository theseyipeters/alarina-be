import type { Types } from 'mongoose'
import { logger } from '../config/logger.js'
import { Contribution, linesOf, type ContributionDoc } from '../models/contribution.js'
import { Couple } from '../models/couple.js'
import { Rsvp } from '../models/rsvp.js'
import { User } from '../models/user.js'
import { Wedding } from '../models/wedding.js'
import { giftReceivedEmail, rsvpReceivedEmail, type RenderedEmail } from './emails.js'
import { sendMail } from './mailer.js'

// Emails to the couple when a guest replies or a gift goes through. Each partner gets their own
// copy. These run after the guest's request is answered and never throw: a notice that fails
// must never fail the guest. Suspended couples can't sign in, so they aren't emailed.

type WeddingRef = { _id: Types.ObjectId; coupleId: Types.ObjectId }

async function emailCouple(coupleId: unknown, build: (name: string) => RenderedEmail) {
  const couple = await Couple.findById(coupleId)
  if (!couple || couple.suspendedAt) return
  const members = await User.find({ _id: { $in: couple.members } }).select('name email')
  await Promise.all(members.map((m) => sendMail({ to: m.email, ...build(m.name) })))
}

const quietly = (what: string, work: Promise<unknown>) =>
  void work.catch((err: unknown) => logger.error({ err }, `Couldn’t notify the couple about ${what}`))

/** A guest has just replied for the first time. */
export const notifyRsvp = (wedding: WeddingRef, rsvp: { name: string; attending: boolean }) =>
  quietly(
    'an RSVP',
    (async () => {
      const [info, comingSoFar] = await Promise.all([
        Wedding.findById(wedding._id).select('partnerOneName partnerTwoName'),
        Rsvp.countDocuments({ weddingId: wedding._id, attending: true }),
      ])
      if (!info) return
      await emailCouple(wedding.coupleId, (name) =>
        rsvpReceivedEmail({ name, wedding: info, guestName: rsvp.name, attending: rsvp.attending, comingSoFar }),
      )
    })(),
  )

/** A guest's payment has succeeded. Safe to call more than once: only the first call emails. */
export const notifyGift = (gift: { _id: unknown }) =>
  quietly(
    'a gift',
    (async () => {
      // The webhook and the guest's return from Paystack can settle the same payment at once.
      const claimed = await Contribution.findOneAndUpdate(
        { _id: gift._id, status: 'success', coupleNotifiedAt: null },
        { $set: { coupleNotifiedAt: new Date() } },
        { returnDocument: 'after' },
      )
      if (!claimed) return
      const wedding = await Wedding.findById(claimed.weddingId).select('coupleId partnerOneName partnerTwoName')
      if (!wedding) return
      const paid: ContributionDoc = claimed
      await emailCouple(wedding.coupleId, (name) =>
        giftReceivedEmail({ name, wedding, guestName: paid.guestName, lines: linesOf(paid), amount: paid.amount }),
      )
    })(),
  )
