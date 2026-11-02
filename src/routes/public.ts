import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { isDuplicateKeyError } from '../db/transaction.js'
import { HttpError } from '../lib/httpError.js'
import { MAX_ITEMS, MAX_QUANTITY } from '../lib/asoEbi.js'
import { grossUp, MAX_GIFT, MIN_GIFT } from '../lib/fees.js'
import { fundedByItem, MAX_WISHLIST_ITEMS, MIN_CONTRIBUTION } from '../lib/wishlist.js'
import { rsvpLinkEmail } from '../lib/emails.js'
import { invitationContent, rsvpStatus, type Wedding as WeddingRecord } from '../lib/invitation.js'
import { sendMail } from '../lib/mailer.js'
import { initializeTransaction, paystackConfigured, verifyTransaction } from '../lib/paystack.js'
import { settle } from '../lib/settle.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { giftCreateLimiter, publicLookupLimiter, rsvpCreateLimiter } from '../middleware/rateLimit.js'
import { Contribution, linesOf, type Line } from '../models/contribution.js'
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

const invitationDto = async (w: WeddingRecord) => {
  const status = rsvpStatus(w)
  const funded = wishlistOpen(w) ? await fundedByItem(w._id) : null
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
          imageId: i.imageId ?? null,
          unit: i.unit,
          price: i.price,
        }))
      : [],
    // What's left to give is price − funded; a fully funded item stays listed so guests see it was taken.
    wishlist: funded
      ? w.wishlistItems.map((i) => ({
          id: String(i._id),
          name: i.name,
          description: i.description ?? '',
          imageId: i.imageId ?? null,
          price: i.price,
          funded: Math.min(i.price, funded.get(String(i._id)) ?? 0),
        }))
      : [],
  }
}

/** Guests are offered a gift only when the couple switched it on and payouts are ready. */
const giftsOpen = (w: WeddingRecord) => Boolean(w.giftsUnlockedAt) && w.giftsEnabled && Boolean(w.payout?.subaccountCode) && paystackConfigured()

/** Aso-ebi is offered when it's switched on, has something to buy, and payouts are ready. */
const asoEbiOpen = (w: WeddingRecord) =>
  Boolean(w.giftsUnlockedAt) && w.asoEbiEnabled && w.asoEbiItems.length > 0 && Boolean(w.payout?.subaccountCode) && paystackConfigured()

/** The wishlist is offered when it's switched on, has something on it, and payouts are ready. */
const wishlistOpen = (w: WeddingRecord) =>
  Boolean(w.giftsUnlockedAt) && w.wishlistEnabled && w.wishlistItems.length > 0 && Boolean(w.payout?.subaccountCode) && paystackConfigured()

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
  res.json({ invitation: await invitationDto(wedding) })
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
  res.json({ rsvp: rsvpDto(rsvp), invitation: await invitationDto(wedding), editExpiresAt: rsvp.editExpiresAt })
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
  res.json({ rsvp: rsvpDto(rsvp), invitation: await invitationDto(wedding), editExpiresAt: rsvp.editExpiresAt })
})

const checkoutInput = z
  .object({
    // Naira, whole numbers: what the couple should receive as cash. Paystack's fee is added on top.
    cash: z.number().int().min(MIN_GIFT / 100).max(MAX_GIFT / 100).optional(),
    asoEbi: z
      .array(z.object({ itemId: z.string().max(40), quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
      .max(MAX_ITEMS)
      .optional(),
    name: z.string().trim().min(1).max(80),
    email: z.email().max(254),
    // Naira chosen towards each wishlist item: the rest of the item, or a part of it.
    wishlist: z
      .array(z.object({ itemId: z.string().max(40), amount: z.number().int().min(1).max(MAX_GIFT / 100) }))
      .max(MAX_WISHLIST_ITEMS)
      .optional(),
    phone: phone.optional(),
    // The guest's private RSVP link token, to connect the payment to their reply. Optional.
    rsvpToken: z.string().max(100).optional(),
  })
  .refine((v) => v.cash !== undefined || (v.asoEbi?.length ?? 0) > 0 || (v.wishlist?.length ?? 0) > 0, { message: 'Choose something to give' })
  .refine((v) => !v.asoEbi?.length || v.phone, { message: 'Add a phone number for your aso-ebi order', path: ['phone'] })

// One checkout for a guest's whole basket: a cash gift, aso-ebi and/or wishlist items, paid in a single Paystack
// transaction so the guest pays the fee once. The couple receive exactly the sum of the lines.
publicRouter.post('/invitations/:slug/checkout', giftCreateLimiter, async (req, res) => {
  const wedding = await findPublished(String(req.params.slug))
  if (!wedding) throw notFound()

  const input = checkoutInput.parse(req.body)
  const lines: Line[] = []

  if (input.cash !== undefined) {
    if (!giftsOpen(wedding)) throw new HttpError(409, 'This couple isn’t accepting cash gifts', 'gifts_closed')
    lines.push({ kind: 'cash', amount: input.cash * 100 })
  }

  if (input.asoEbi?.length) {
    if (!asoEbiOpen(wedding)) throw new HttpError(409, 'This couple isn’t offering aso-ebi', 'aso_ebi_closed')
    for (const { itemId, quantity } of input.asoEbi) {
      const item = wedding.asoEbiItems.find((i) => String(i._id) === itemId)
      if (!item) throw new HttpError(404, 'An item in your basket isn’t available any more', 'item_not_found')
      if (lines.some((l) => l.itemId === itemId)) throw new HttpError(400, 'Each item can only appear once', 'duplicate_item')
      lines.push({
        kind: 'aso_ebi',
        amount: item.price * quantity,
        itemId,
        itemName: item.name,
        unit: item.unit,
        unitPrice: item.price,
        quantity,
      })
    }
  }

  if (input.wishlist?.length) {
    if (!wishlistOpen(wedding)) throw new HttpError(409, 'This couple isn’t sharing a wishlist', 'wishlist_closed')
    const funded = await fundedByItem(wedding._id)
    for (const { itemId, amount } of input.wishlist) {
      const item = wedding.wishlistItems.find((i) => String(i._id) === itemId)
      if (!item) throw new HttpError(404, 'An item in your basket isn’t available any more', 'item_not_found')
      if (lines.some((l) => l.itemId === itemId)) throw new HttpError(400, 'Each item can only appear once', 'duplicate_item')
      const remaining = item.price - (funded.get(itemId) ?? 0)
      if (remaining <= 0) throw new HttpError(409, `${item.name} has already been fully gifted`, 'item_funded')
      // Each chip-in is at least MIN_CONTRIBUTION, unless less than that is left to give.
      const kobo = amount * 100
      if (kobo > remaining || kobo < Math.min(MIN_CONTRIBUTION, remaining)) {
        throw new HttpError(
          409,
          `${item.name} needs between ${Math.min(MIN_CONTRIBUTION, remaining) / 100} and ${remaining / 100} naira`,
          'invalid_contribution',
        )
      }
      lines.push({ kind: 'wishlist', amount: kobo, itemId, itemName: item.name, unitPrice: item.price })
    }
  }

  const amount = lines.reduce((sum, l) => sum + l.amount, 0)
  if (amount > MAX_GIFT) throw new HttpError(400, 'That basket is too large. Remove something and try again.', 'basket_too_large')

  const rsvp = input.rsvpToken
    ? await Rsvp.findOne({ editTokenHash: hashToken(input.rsvpToken), weddingId: wedding._id })
    : null
  const { charge, fee } = grossUp(amount)
  const reference = `alr_${randomBytes(12).toString('hex')}`

  const payment = await Contribution.create({
    weddingId: wedding._id,
    ...(rsvp && { rsvpId: rsvp._id }),
    guestName: input.name,
    guestEmail: input.email.toLowerCase(),
    ...(input.phone && { guestPhone: input.phone }),
    lines,
    amount,
    fee,
    charge,
    reference,
  })

  try {
    const checkout = await initializeTransaction({
      email: payment.guestEmail,
      amount: charge,
      reference,
      subaccount: wedding.payout!.subaccountCode,
      callback_url: `${env.CLIENT_ORIGIN}/invite/${wedding.slug}/gift`,
      metadata: { weddingId: String(wedding._id), guestName: payment.guestName, coupleReceives: amount, lines: lines.length },
    })
    res.status(201).json({ reference, checkoutUrl: checkout.authorization_url, amount, fee, charge })
  } catch (err) {
    // The RSVP is untouched; the attempt is simply marked failed.
    payment.status = 'failed'
    await payment.save()
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
      status: gift.status,
      amount: gift.amount,
      guestName: gift.guestName,
      lines: linesOf(gift).map((l) => ({
        kind: l.kind,
        amount: l.amount,
        itemName: l.itemName ?? null,
        unit: l.unit ?? null,
        quantity: l.quantity ?? null,
      })),
    },
    invitation: wedding.slug ? await invitationDto(wedding) : null,
  })
})
