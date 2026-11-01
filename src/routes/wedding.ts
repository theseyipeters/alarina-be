import { Router } from 'express'
import type { HydratedDocument, Types, UpdateQuery } from 'mongoose'
import { z } from 'zod'
import { isDuplicateKeyError } from '../db/transaction.js'
import { calendarDate, clockTime, todayInLagos } from '../lib/dates.js'
import { PALETTES, TEMPLATES } from '../lib/design.js'
import { HttpError } from '../lib/httpError.js'
import { invitationContent } from '../lib/invitation.js'
import { makeSlug } from '../lib/slug.js'
import { requireAuth } from '../middleware/auth.js'
import { Wedding, type WeddingDoc } from '../models/wedding.js'

export const weddingRouter = Router()

weddingRouter.use(requireAuth)

// Blank strings clear a field, so a couple can delete an answer by emptying the input.
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional()
const date = () => z.preprocess(blankToNull, calendarDate.nullable()).optional()
const time = () => z.preprocess(blankToNull, clockTime.nullable()).optional()

const eventInput = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  date: date(),
  startTime: time(),
  venueName: text(120),
  venueAddress: text(200),
})

const patchBody = z.strictObject({
  partnerOneName: text(60),
  partnerTwoName: text(60),
  partnerOneFamily: text(80),
  partnerTwoFamily: text(80),
  date: date(),
  startTime: time(),
  venueName: text(120),
  venueAddress: text(200),
  dressNote: text(200),
  message: text(1000),
  rsvpDeadline: date(),
  events: z.array(eventInput).max(10).optional(),
  template: z.enum(TEMPLATES).optional(),
  palette: z.enum(PALETTES).optional(),
  checkpoint: z.number().int().min(0).max(50).optional(),
})

const REQUIRED_TO_PUBLISH = ['partnerOneName', 'partnerTwoName', 'date', 'startTime', 'venueName'] as const

type Wedding = HydratedDocument<WeddingDoc>

const weddingDto = (w: Wedding) => ({
  id: String(w._id),
  slug: w.slug ?? null,
  status: w.status,
  checkpoint: w.checkpoint,
  setupCompletedAt: w.setupCompletedAt ?? null,
  publishedAt: w.publishedAt ?? null,
  ...invitationContent(w),
})

/** What still blocks publishing, keyed by field. Empty when the wedding can go live. */
function publishProblems(w: Wedding) {
  const problems: Record<string, string> = {}
  for (const key of REQUIRED_TO_PUBLISH) if (!w[key]) problems[key] = 'Required to publish'
  if (w.date && w.date < todayInLagos()) problems.date = 'The wedding date has already passed'
  if (w.rsvpDeadline && w.date && w.rsvpDeadline > w.date) {
    problems.rsvpDeadline = 'The RSVP deadline must be on or before the wedding date'
  }
  return problems
}

const findWedding = (coupleId: Types.ObjectId) => Wedding.findOne({ coupleId })

async function requireWedding(coupleId: Types.ObjectId) {
  const wedding = await findWedding(coupleId)
  if (!wedding) throw new HttpError(404, 'Start your wedding setup first', 'no_wedding')
  return wedding
}

weddingRouter.get('/', async (req, res) => {
  const wedding = await findWedding(req.auth!.user.coupleId)
  res.json({ wedding: wedding ? weddingDto(wedding) : null })
})

// Autosave. Creates the wedding on first save; only the fields sent are touched, so two partners
// editing different answers at once don't overwrite each other.
weddingRouter.patch('/', async (req, res) => {
  const coupleId = req.auth!.user.coupleId
  const { checkpoint, events, ...fields } = patchBody.parse(req.body)

  const existing = await findWedding(coupleId)
  if (existing?.status === 'published') {
    const cleared = REQUIRED_TO_PUBLISH.filter((k) => fields[k] === null)
    if (cleared.length) {
      throw new HttpError(422, 'A published invitation needs this answer', 'required_when_published', {
        fields: cleared,
      })
    }
  }

  const $set: Record<string, unknown> = {}
  const $unset: Record<string, ''> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (value === null) $unset[key] = ''
    else $set[key] = value
  }
  if (events) {
    $set.events = events.map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v != null)))
  }

  const update: UpdateQuery<WeddingDoc> = {}
  if (Object.keys($set).length) update.$set = $set
  if (Object.keys($unset).length) update.$unset = $unset
  update.$max = { checkpoint: checkpoint ?? 0 }

  const save = () =>
    Wedding.findOneAndUpdate({ coupleId }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }).orFail()

  // Both partners saving for the very first time can race on the upsert; the loser retries as an update.
  const wedding = await save().catch((err) => (isDuplicateKeyError(err) ? save() : Promise.reject(err)))
  res.json({ wedding: weddingDto(wedding) })
})

// Finish setup without publishing: the invitation stays private.
weddingRouter.post('/finish', async (req, res) => {
  const wedding = await requireWedding(req.auth!.user.coupleId)
  wedding.setupCompletedAt ??= new Date()
  await wedding.save()
  res.json({ wedding: weddingDto(wedding) })
})

weddingRouter.post('/publish', async (req, res) => {
  const wedding = await requireWedding(req.auth!.user.coupleId)

  const problems = publishProblems(wedding)
  if (Object.keys(problems).length) {
    throw new HttpError(422, 'Some details are needed before you can publish', 'not_ready', { problems })
  }

  // The slug is assigned once, on first publish. Retry if the random suffix happens to collide.
  for (let attempt = 0; !wedding.slug; attempt++) {
    const slug = makeSlug(wedding.partnerOneName, wedding.partnerTwoName)
    try {
      await Wedding.updateOne({ _id: wedding._id, slug: { $exists: false } }, { $set: { slug } })
      wedding.slug = (await Wedding.findById(wedding._id).orFail()).slug
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt >= 4) throw err
    }
  }

  wedding.status = 'published'
  wedding.publishedAt ??= new Date()
  wedding.setupCompletedAt ??= new Date()
  await wedding.save()
  res.json({ wedding: weddingDto(wedding) })
})

weddingRouter.post('/unpublish', async (req, res) => {
  const wedding = await requireWedding(req.auth!.user.coupleId)
  wedding.status = 'draft'
  await wedding.save()
  res.json({ wedding: weddingDto(wedding) })
})
