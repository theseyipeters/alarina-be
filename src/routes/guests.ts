import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import mongoose, { type HydratedDocument, type Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { rsvpRejectedEmail, rsvpRestoredEmail } from '../lib/emails.js'
import { HttpError } from '../lib/httpError.js'
import { sendMail } from '../lib/mailer.js'
import { requireAuth } from '../middleware/auth.js'
import { Couple } from '../models/couple.js'
import { replyKind, Rsvp, type RsvpDoc } from '../models/rsvp.js'
import { User } from '../models/user.js'
import { Wedding } from '../models/wedding.js'

// The couple's view of their guests: replies, which side they came from, and share links.
// Every query is scoped to the signed-in user's own wedding.
export const guestsRouter = Router()

guestsRouter.use(requireAuth)

async function coupleContext(coupleId: Types.ObjectId) {
  const [wedding, couple] = await Promise.all([Wedding.findOne({ coupleId }), Couple.findById(coupleId).orFail()])
  if (!wedding) throw new HttpError(404, 'Start your wedding setup first', 'no_wedding')
  const members = await User.find({ _id: { $in: couple.members } }, { name: 1 })
  return { wedding, members }
}

const newShareCode = () => randomBytes(6).toString('base64url')

guestsRouter.get('/share-links', async (req, res) => {
  const { user } = req.auth!
  const { wedding, members } = await coupleContext(user.coupleId)

  // Each partner gets a code the first time links are requested. The filter makes this
  // safe if both partners open the page at once.
  for (const member of members) {
    if (wedding.shareLinks.some((l) => String(l.userId) === String(member._id))) continue
    await Wedding.updateOne(
      { _id: wedding._id, 'shareLinks.userId': { $ne: member._id } },
      { $push: { shareLinks: { userId: member._id, code: newShareCode() } } },
    )
  }
  const fresh = await Wedding.findById(wedding._id).orFail()

  const base = fresh.slug ? `${env.CLIENT_ORIGIN}/invite/${fresh.slug}` : null
  res.json({
    generalLink: base,
    links: members.map((m) => {
      const code = fresh.shareLinks.find((l) => String(l.userId) === String(m._id))?.code
      return {
        userId: String(m._id),
        name: m.name,
        isYou: String(m._id) === String(user._id),
        link: base && code ? `${base}?from=${code}` : null,
      }
    }),
  })
})

const responseDto = (r: HydratedDocument<RsvpDoc>) => ({
  id: String(r._id),
  name: r.name,
  email: r.email,
  phone: r.phone,
  attending: r.attending,
  rejected: Boolean(r.rejectedAt),
  rejectionNote: r.rejectionNote ?? null,
  sideUserId: r.sideUserId ? String(r.sideUserId) : null,
  sideSource: r.sideSource ?? null,
  editLinkActive: !r.editRevokedAt && r.editExpiresAt > new Date(),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

guestsRouter.get('/rsvps', async (req, res) => {
  const { wedding, members } = await coupleContext(req.auth!.user.coupleId)
  const rsvps = await Rsvp.find({ weddingId: wedding._id }).sort({ createdAt: -1 })

  const count = (list: typeof rsvps) => ({
    total: list.length,
    attending: list.filter((r) => replyKind(r) === 'attending').length,
    declined: list.filter((r) => replyKind(r) === 'declined').length,
    rejected: list.filter((r) => replyKind(r) === 'rejected').length,
  })

  res.json({
    partners: members.map((m) => ({ userId: String(m._id), name: m.name })),
    summary: {
      ...count(rsvps),
      bySide: [
        ...members.map((m) => ({
          userId: String(m._id),
          ...count(rsvps.filter((r) => String(r.sideUserId) === String(m._id))),
        })),
        { userId: null, ...count(rsvps.filter((r) => !r.sideUserId)) },
      ],
    },
    rsvps: rsvps.map(responseDto),
  })
})

async function findOwnRsvp(weddingId: Types.ObjectId, id: string) {
  const rsvp = mongoose.isValidObjectId(id) ? await Rsvp.findOne({ _id: id, weddingId }) : null
  if (!rsvp) throw new HttpError(404, 'That reply wasn’t found', 'rsvp_not_found')
  return rsvp
}

const sideBody = z.strictObject({ sideUserId: z.string().nullable() })

// Correct or clear the side. A manual change always wins over the link it came through.
guestsRouter.patch('/rsvps/:id', async (req, res) => {
  const { wedding, members } = await coupleContext(req.auth!.user.coupleId)
  const rsvp = await findOwnRsvp(wedding._id, String(req.params.id))
  const { sideUserId } = sideBody.parse(req.body)

  if (sideUserId && !members.some((m) => String(m._id) === sideUserId)) {
    throw new HttpError(400, 'Choose one of the two of you', 'invalid_side')
  }
  rsvp.set({ sideUserId: sideUserId ?? undefined, sideSource: sideUserId ? 'couple' : undefined })
  await rsvp.save()
  res.json({ rsvp: responseDto(rsvp) })
})

// Stops the guest's private edit link from working, e.g. if it was shared by mistake.
guestsRouter.post('/rsvps/:id/revoke-link', async (req, res) => {
  const { wedding } = await coupleContext(req.auth!.user.coupleId)
  const rsvp = await findOwnRsvp(wedding._id, String(req.params.id))
  rsvp.editRevokedAt ??= new Date()
  await rsvp.save()
  res.json({ rsvp: responseDto(rsvp) })
})

const rejectBody = z.strictObject({ note: z.string().trim().max(300).optional() })

// Rejects a guest who accepted and emails them. Their private link stops letting them change their
// reply. The update is conditional so a double click can't email the guest twice.
guestsRouter.post('/rsvps/:id/reject', async (req, res) => {
  const { wedding } = await coupleContext(req.auth!.user.coupleId)
  const found = await findOwnRsvp(wedding._id, String(req.params.id))
  const { note } = rejectBody.parse(req.body)

  if (found.rejectedAt) return void res.json({ rsvp: responseDto(found), emailSent: true })
  const rsvp = await Rsvp.findOneAndUpdate(
    { _id: found._id, attending: true, rejectedAt: null },
    { $set: { rejectedAt: new Date(), ...(note && { rejectionNote: note }) } },
    { returnDocument: 'after' },
  )
  if (!rsvp) throw new HttpError(409, 'Only a guest who accepted can be rejected', 'rsvp_not_attending')

  const emailSent = await sendMail({ to: rsvp.email, ...rsvpRejectedEmail({ wedding, guestName: rsvp.name, note }) })
  res.json({ rsvp: responseDto(rsvp), emailSent })
})

// Undoes a rejection, in case it was a mistake, and tells the guest their place is confirmed.
guestsRouter.post('/rsvps/:id/restore', async (req, res) => {
  const { wedding } = await coupleContext(req.auth!.user.coupleId)
  const found = await findOwnRsvp(wedding._id, String(req.params.id))

  const rsvp = await Rsvp.findOneAndUpdate(
    { _id: found._id, rejectedAt: { $ne: null } },
    { $unset: { rejectedAt: 1, rejectionNote: 1 } },
    { returnDocument: 'after' },
  )
  if (!rsvp) return void res.json({ rsvp: responseDto(found), emailSent: true })

  const emailSent = await sendMail({
    to: rsvp.email,
    ...rsvpRestoredEmail({ wedding, guestName: rsvp.name, link: `${env.CLIENT_ORIGIN}/invite/${wedding.slug}` }),
  })
  res.json({ rsvp: responseDto(rsvp), emailSent })
})
