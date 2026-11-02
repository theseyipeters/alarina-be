import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { isDuplicateKeyError } from '../db/transaction.js'
import { HttpError } from '../lib/httpError.js'
import { MAX_QUANTITY } from '../lib/asoEbi.js'
import { grossUp, MAX_GIFT, MIN_GIFT } from '../lib/fees.js'
import { rsvpLinkEmail } from '../lib/emails.js'
import { invitationContent, rsvpStatus, type Wedding as WeddingRecord } from '../lib/invitation.js'
import { sendMail } from '../lib/mailer.js'
import { initializeTransaction, paystackConfigured, verifyTransaction } from '../lib/paystack.js'
import { settle } from '../lib/settle.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { giftCreateLimiter, publicLookupLimiter, rsvpCreateLimiter } from '../middleware/rateLimit.js'
import { Contribution } from '../models/contribution.js'
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

const invitationDto = (w: WeddingRecord) => {
  const status = rsvpStatus(w)
  return {
    slug: w.slug,
    ...invitationContent(w),
    rsvpOpen: status.open,
    rsvpClosedReason: status.open ? null : status.reason,
    giftsEnabled: giftsOpen(w),
    asoEbi: asoEbiOpen(w)
      ? w.asoEbiItems.map((i) => ({
          id: String(i._id),
          name: i.name,
          description: i.description ?? '',
          unit: i.unit,
          price: i.price,
        }))
      : [],
  }
}

/** Guests are offered a gift only when the couple switched it on and payouts are ready. */
const giftsOpen = (w: WeddingRecord) => w.giftsEnabled && Boolean(w.payout?.subaccountCode) && paystackConfigured()

/** Aso-ebi is offered when it's switched on, has something to buy, and payouts are ready. */
const asoEbiOpen = (w: WeddingRecord) =>
  w.asoEbiEnabled && w.asoEbiItems.length > 0 && Boolean(w.payout?.subaccountCode) && paystackConfigured()

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

/** Emails the guest their private link. `isResend`: they'd already replied, so it's a fresh one. */
const sendEditLink = (wedding: WeddingRecord, rsvp: RsvpDoc, link: string, expiresAt: Date, isResend: boolean) =>
  sendMail({
    to: rsvp.email,
    ...rsvpLinkEmail({ wedding, guestName: rsvp.name, attending: rsvp.attending, link, expiresAt, isResend }),
  })

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
    const emailSent = await sendEditLink(wedding, rsvp, link, rsvp.editExpiresAt, false)
    res.status(201).json({ rsvp: rsvpDto(rsvp), editLink: link, editExpiresAt: rsvp.editExpiresAt, emailSent })
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err

    // Already replied. If email works, send a fresh private link to that address (never to the
    // requester's screen), and only then retire the old one so the guest is never left without a link.
    const existing = await Rsvp.findOne({ weddingId: wedding._id, email }).orFail()
    const expiresAt = editExpiry(wedding)
    const emailSent = await sendEditLink(wedding, existing, editLink(token), expiresAt, true)
    if (emailSent) {
      existing.editTokenHash = tokenHash
      existing.editExpiresAt = expiresAt
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

const giftInput = z.object({
  // Naira, whole numbers: what the couple should receive. Paystack's fee is added on top.
  amount: z.number().int().min(MIN_GIFT / 100).max(MAX_GIFT / 100),
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  // The guest's private RSVP link token, to connect the gift to their reply. Optional.
  rsvpToken: z.string().max(100).optional(),
})

publicRouter.post('/invitations/:slug/gifts', giftCreateLimiter, async (req, res) => {
  const wedding = await findPublished(String(req.params.slug))
  if (!wedding) throw notFound()
  if (!giftsOpen(wedding)) throw new HttpError(409, 'This couple isn’t accepting cash gifts', 'gifts_closed')

  const input = giftInput.parse(req.body)
  const rsvp = input.rsvpToken
    ? await Rsvp.findOne({ editTokenHash: hashToken(input.rsvpToken), weddingId: wedding._id })
    : null

  const amount = input.amount * 100
  const { charge, fee } = grossUp(amount)
  const reference = `alr_${randomBytes(12).toString('hex')}`

  const gift = await Contribution.create({
    weddingId: wedding._id,
    ...(rsvp && { rsvpId: rsvp._id }),
    guestName: input.name,
    guestEmail: input.email.toLowerCase(),
    amount,
    fee,
    charge,
    reference,
  })

  try {
    const checkout = await initializeTransaction({
      email: gift.guestEmail,
      amount: charge,
      reference,
      subaccount: wedding.payout!.subaccountCode,
      callback_url: `${env.CLIENT_ORIGIN}/invite/${wedding.slug}/gift`,
      metadata: { weddingId: String(wedding._id), guestName: gift.guestName, coupleReceives: amount },
    })
    res.status(201).json({ reference, checkoutUrl: checkout.authorization_url, amount, fee, charge })
  } catch (err) {
    // The RSVP is untouched; the gift attempt is simply marked failed.
    gift.status = 'failed'
    await gift.save()
    throw err
  }
})

const asoEbiInput = z.object({
  itemId: z.string().max(40),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  phone,
  rsvpToken: z.string().max(100).optional(),
})

publicRouter.post('/invitations/:slug/aso-ebi', giftCreateLimiter, async (req, res) => {
  const wedding = await findPublished(String(req.params.slug))
  if (!wedding) throw notFound()
  if (!asoEbiOpen(wedding)) throw new HttpError(409, 'This couple isn’t offering aso-ebi', 'aso_ebi_closed')

  const input = asoEbiInput.parse(req.body)
  const item = wedding.asoEbiItems.find((i) => String(i._id) === input.itemId)
  if (!item) throw new HttpError(404, 'That item isn’t available any more', 'item_not_found')
  const rsvp = input.rsvpToken
    ? await Rsvp.findOne({ editTokenHash: hashToken(input.rsvpToken), weddingId: wedding._id })
    : null

  // The couple receives exactly price × quantity; Paystack's fee is added on top for the guest.
  const amount = item.price * input.quantity
  if (amount > MAX_GIFT) throw new HttpError(400, 'That order is too large. Choose a smaller quantity.', 'order_too_large')
  const { charge, fee } = grossUp(amount)
  const reference = `alr_${randomBytes(12).toString('hex')}`

  const order = await Contribution.create({
    kind: 'aso_ebi',
    weddingId: wedding._id,
    ...(rsvp && { rsvpId: rsvp._id }),
    guestName: input.name,
    guestEmail: input.email.toLowerCase(),
    asoEbi: {
      itemId: String(item._id),
      itemName: item.name,
      unit: item.unit,
      unitPrice: item.price,
      quantity: input.quantity,
      phone: input.phone,
    },
    amount,
    fee,
    charge,
    reference,
  })

  try {
    const checkout = await initializeTransaction({
      email: order.guestEmail,
      amount: charge,
      reference,
      subaccount: wedding.payout!.subaccountCode,
      callback_url: `${env.CLIENT_ORIGIN}/invite/${wedding.slug}/gift`,
      metadata: {
        weddingId: String(wedding._id),
        guestName: order.guestName,
        kind: 'aso_ebi',
        item: item.name,
        quantity: input.quantity,
        coupleReceives: amount,
      },
    })
    res.status(201).json({ reference, checkoutUrl: checkout.authorization_url, amount, fee, charge })
  } catch (err) {
    order.status = 'failed'
    await order.save()
    throw err
  }
})

// Where the guest lands after Paystack. Confirms the outcome with Paystack directly, then
// returns enough of the invitation to theme the thank-you page.
publicRouter.get('/gifts/:reference', publicLookupLimiter, async (req, res) => {
  const gift = await Contribution.findOne({ reference: String(req.params.reference) })
  const wedding = gift && (await Wedding.findById(gift.weddingId))
  if (!gift || !wedding) throw new HttpError(404, 'We couldn’t find that gift', 'gift_not_found')

  if (gift.status === 'pending') await settle(gift, await verifyTransaction(gift.reference))

  res.json({
    gift: {
      kind: gift.kind,
      status: gift.status,
      amount: gift.amount,
      guestName: gift.guestName,
      item: gift.asoEbi ? { name: gift.asoEbi.itemName, unit: gift.asoEbi.unit, quantity: gift.asoEbi.quantity } : null,
    },
    invitation: wedding.slug ? invitationDto(wedding) : null,
  })
})
