import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { isDuplicateKeyError } from '../db/transaction.js'
import { HttpError } from '../lib/httpError.js'
import { invitationContent, rsvpStatus, type Wedding as WeddingRecord } from '../lib/invitation.js'
import { sendMail } from '../lib/mailer.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { publicLookupLimiter, rsvpCreateLimiter } from '../middleware/rateLimit.js'
import { Rsvp, type RsvpDoc } from '../models/rsvp.js'
import { Wedding } from '../models/wedding.js'

// Guest-facing routes. No sign-in; access is by the invitation slug or a private RSVP link.
export const publicRouter = Router()

const DAY = 24 * 60 * 60 * 1000

const notFound = () => new HttpError(404, 'This invitation isn’t available', 'invitation_not_found')
const linkInvalid = () =>
  new HttpError(
    404,
    'This link has expired or is no longer valid. Contact the couple if you need to change your reply.',
    'rsvp_link_invalid',
  )

const coupleNames = (w: WeddingRecord) => [w.partnerOneName, w.partnerTwoName].filter(Boolean).join(' & ')

const invitationDto = (w: WeddingRecord) => {
  const status = rsvpStatus(w)
  return {
    slug: w.slug,
    ...invitationContent(w),
    rsvpOpen: status.open,
    rsvpClosedReason: status.open ? null : status.reason,
  }
}

const rsvpDto = (r: HydratedDocument<RsvpDoc>) => ({
  name: r.name,
  email: r.email,
  phone: r.phone,
  attending: r.attending,
  updatedAt: r.updatedAt,
})

const editLink = (token: string) => `${env.CLIENT_ORIGIN}/rsvp/${token}`

/** Edit links work until the end of the wedding day (Lagos time), or 180 days if no date is set. */
const editExpiry = (w: WeddingRecord) =>
  w.date ? new Date(`${w.date}T23:59:59+01:00`) : new Date(Date.now() + 180 * DAY)

const findPublished = (slug: string) => Wedding.findOne({ slug, status: 'published' })

async function sendEditLink(w: WeddingRecord, to: string, link: string, isReminder: boolean) {
  const names = coupleNames(w)
  return sendMail({
    to,
    subject: isReminder ? `Your RSVP link for ${names}’s wedding` : `Thanks for your reply to ${names}`,
    text: `${isReminder ? 'Here is a new link' : 'Thanks for replying. Here is your private link'} to view or change your RSVP for ${names}’s wedding:\n\n${link}\n\nKeep it to yourself: anyone with this link can change your reply. Any earlier link no longer works.`,
  })
}

publicRouter.get('/invitations/:slug', publicLookupLimiter, async (req, res) => {
  const wedding = await findPublished(String(req.params.slug))
  if (!wedding) throw notFound()
  res.json({ invitation: invitationDto(wedding) })
})

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, 'Enter a valid phone number')

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  phone,
  attending: z.boolean(),
  // Share code from a partner's personal link. Unknown codes are ignored, not rejected.
  from: z.string().trim().max(32).optional(),
})

publicRouter.post('/invitations/:slug/rsvps', rsvpCreateLimiter, async (req, res) => {
  const wedding = await findPublished(String(req.params.slug))
  if (!wedding) throw notFound()

  const status = rsvpStatus(wedding)
  if (!status.open) {
    throw new HttpError(
      409,
      status.reason === 'past' ? 'This wedding has already taken place' : 'RSVPs for this wedding have closed',
      'rsvp_closed',
    )
  }

  const { from, ...input } = createBody.parse(req.body)
  const email = input.email.toLowerCase()
  const side = from ? wedding.shareLinks.find((l) => l.code === from) : undefined
  const { token, tokenHash } = newToken()

  try {
    const rsvp = await Rsvp.create({
      ...input,
      email,
      weddingId: wedding._id,
      ...(side && { sideUserId: side.userId, sideSource: 'link' }),
      editTokenHash: tokenHash,
      editExpiresAt: editExpiry(wedding),
    })
    const link = editLink(token)
    const emailSent = await sendEditLink(wedding, email, link, false)
    res.status(201).json({ rsvp: rsvpDto(rsvp), editLink: link, editExpiresAt: rsvp.editExpiresAt, emailSent })
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err

    // Already replied. If email works, send a fresh private link to that address (never to the
    // requester's screen), and only then retire the old one so the guest is never left without a link.
    const existing = await Rsvp.findOne({ weddingId: wedding._id, email }).orFail()
    const emailSent = await sendEditLink(wedding, email, editLink(token), true)
    if (emailSent) {
      existing.editTokenHash = tokenHash
      existing.editExpiresAt = editExpiry(wedding)
      existing.editRevokedAt = undefined
      await existing.save()
    }
    throw new HttpError(409, 'You’ve already replied with this email', 'already_responded', { emailSent })
  }
})

async function findByEditToken(token: string) {
  const rsvp = await Rsvp.findOne({
    editTokenHash: hashToken(token),
    editRevokedAt: null,
    editExpiresAt: { $gt: new Date() },
  })
  const wedding = rsvp && (await Wedding.findOne({ _id: rsvp.weddingId, status: 'published' }))
  if (!rsvp || !wedding) throw linkInvalid()
  return { rsvp, wedding }
}

publicRouter.get('/rsvps/:token', publicLookupLimiter, async (req, res) => {
  const { rsvp, wedding } = await findByEditToken(String(req.params.token))
  res.json({ rsvp: rsvpDto(rsvp), invitation: invitationDto(wedding), editExpiresAt: rsvp.editExpiresAt })
})

// The email is the guest's identity for this wedding, so it can't be changed here.
const updateBody = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  phone: phone.optional(),
  attending: z.boolean().optional(),
})

publicRouter.patch('/rsvps/:token', publicLookupLimiter, async (req, res) => {
  const { rsvp, wedding } = await findByEditToken(String(req.params.token))
  const input = updateBody.parse(req.body)
  rsvp.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)))
  await rsvp.save()
  res.json({ rsvp: rsvpDto(rsvp), invitation: invitationDto(wedding), editExpiresAt: rsvp.editExpiresAt })
})
