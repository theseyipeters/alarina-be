import { type InferSchemaType, Schema, model } from 'mongoose'
import { ASO_EBI_UNITS } from '../lib/asoEbi.js'
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

// Aso-ebi on offer to guests. The price is in kobo, per `unit`.
const asoEbiItemSchema = new Schema({
  name: { type: String, required: true },
  description: String,
  unit: { type: String, enum: ASO_EBI_UNITS, required: true },
  imageId: String,
  price: { type: Number, required: true },
})

// Something on the couple's wishlist. The price is in kobo.
const wishlistItemSchema = new Schema({
  name: { type: String, required: true },
  description: String,
  imageId: String,
  price: { type: Number, required: true },
})

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

    // Where cash gifts are paid. Only the bank, the resolved account name and the last four
    // digits are kept; the full number lives with Paystack on the couple's subaccount.
    payout: {
      type: new Schema(
        {
          bankCode: { type: String, required: true },
          bankName: { type: String, required: true },
          accountName: { type: String, required: true },
          accountLast4: { type: String, required: true },
          subaccountCode: { type: String, required: true },
          verifiedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: false,
    },
    // Switches cash gifts on for guests. Aso-ebi has its own switch below.
    giftsEnabled: { type: Boolean, default: false, required: true },
    asoEbiEnabled: { type: Boolean, default: false, required: true },
    asoEbiItems: { type: [asoEbiItemSchema], default: [] },
    wishlistEnabled: { type: Boolean, default: false, required: true },
    wishlistItems: { type: [wishlistItemSchema], default: [] },

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
