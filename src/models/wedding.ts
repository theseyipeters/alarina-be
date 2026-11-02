import { type InferSchemaType, Schema, model } from 'mongoose'
import { PALETTES, TEMPLATES } from '../lib/design.js'

// Dates are stored as calendar strings (YYYY-MM-DD) and times as HH:mm, both in Nigerian
// local time. A wedding happens on a day at a place, not at a UTC instant.
const eventSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    date: String,
    startTime: String,
    venueName: String,
    venueAddress: String,
  },
  { _id: false },
)

const weddingSchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true, unique: true },
    // Assigned on first publish and never changed afterwards, so shared links keep working.
    slug: { type: String },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', required: true },
    // Furthest setup step reached. Only ever moves forward.
    checkpoint: { type: Number, default: 0, min: 0 },
    setupCompletedAt: Date,
    publishedAt: Date,

    partnerOneName: String,
    partnerTwoName: String,
    partnerOneFamily: String,
    partnerTwoFamily: String,
    date: String,
    startTime: String,
    venueName: String,
    venueAddress: String,
    dressNote: String,
    message: String,
    rsvpDeadline: String,
    events: { type: [eventSchema], default: [] },

    // Each partner's personal share link (/invite/:slug?from=code). Replies through it are
    // attributed to that partner's side. Attribution is by link, not verified identity.
    shareLinks: {
      type: [{ _id: false, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, code: String }],
      default: [],
    },

    template: { type: String, enum: TEMPLATES, default: 'classic', required: true },
    palette: { type: String, enum: PALETTES, default: 'ivory', required: true },
  },
  { timestamps: true },
)

weddingSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } })
weddingSchema.index(
  { 'shareLinks.code': 1 },
  { unique: true, partialFilterExpression: { 'shareLinks.code': { $type: 'string' } } },
)

export type WeddingDoc = InferSchemaType<typeof weddingSchema>
export const Wedding = model('Wedding', weddingSchema)
