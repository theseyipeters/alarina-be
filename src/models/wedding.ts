import { type InferSchemaType, Schema, model } from 'mongoose'
import { ASO_EBI_UNITS } from '../lib/asoEbi.js'
import {
  BODY_FONTS,
  CORNERS,
  FRAMES,
  HEADING_FONTS,
  JOINERS,
  NAME_CASES,
  NAME_FONTS,
  NAME_SCALE,
  PALETTES,
  TEMPLATES,
  TEXTURES,
} from '../lib/design.js'

/** Who each partner is on the invitation, so captions can read "Parents of the Bride". Optional. */
export const ROLES = ['bride', 'groom'] as const

/** What kind of ceremony the main venue holds; it names the ceremony on the invitation. */
export const CEREMONY_TYPES = ['church', 'mosque', 'registry', 'traditional', 'other'] as const

/** Each partner's father and mother, as written on the invitation (title included). */
export const PARENT_FIELDS = ['partnerOneFather', 'partnerOneMother', 'partnerTwoFather', 'partnerTwoMother'] as const

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

// The couple's own colours, used when the palette is 'custom'. Hex, like #1e1b18.
const customColorsSchema = new Schema(
  {
    background: { type: String, required: true },
    card: { type: String, required: true },
    text: { type: String, required: true },
    accent: { type: String, required: true },
  },
  { _id: false },
)

// Fine-tuning from the Studio. Anything unset follows the template's own default.
const lookSchema = new Schema(
  {
    namesFont: { type: String, enum: NAME_FONTS },
    headingFont: { type: String, enum: HEADING_FONTS },
    bodyFont: { type: String, enum: BODY_FONTS },
    nameScale: { type: Number, min: NAME_SCALE.min, max: NAME_SCALE.max },
    nameCase: { type: String, enum: NAME_CASES },
    joiner: { type: String, enum: JOINERS },
    texture: { type: String, enum: TEXTURES },
    corners: { type: String, enum: CORNERS },
    frame: { type: String, enum: FRAMES },
    colors: { type: customColorsSchema, required: false },
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
    partnerOneRole: { type: String, enum: ROLES },
    partnerTwoRole: { type: String, enum: ROLES },
    // The couple's wedding hashtag, stored without the "#" and in their own capitals: "OlaAndEni2027".
    hashtag: String,
    // The earlier one-line family names. Still shown until the couple adds parents.
    partnerOneFamily: String,
    partnerTwoFamily: String,
    partnerOneFather: String,
    partnerOneMother: String,
    partnerTwoFather: String,
    partnerTwoMother: String,
    // Which of the parents above have passed away; the invitation writes "Late" before their name.
    lateParents: { type: [{ type: String, enum: PARENT_FIELDS }], default: [] },
    date: String,
    // The ceremony: when it starts and where. A reception at the same place needs nothing more.
    startTime: String,
    venueName: String,
    venueAddress: String,
    ceremonyType: { type: String, enum: CEREMONY_TYPES },
    // A reception somewhere else, the same day.
    receptionSeparate: { type: Boolean, default: false, required: true },
    receptionVenueName: String,
    receptionVenueAddress: String,
    receptionTime: String,
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
    // Set when the couple has paid the one-time fee to use Gifts. Nothing in Gifts works before.
    giftsUnlockedAt: Date,
    // Switches cash gifts on for guests. Aso-ebi has its own switch below.
    giftsEnabled: { type: Boolean, default: false, required: true },
    asoEbiEnabled: { type: Boolean, default: false, required: true },
    asoEbiItems: { type: [asoEbiItemSchema], default: [] },
    wishlistEnabled: { type: Boolean, default: false, required: true },
    wishlistItems: { type: [wishlistItemSchema], default: [] },

    template: { type: String, enum: TEMPLATES, default: 'classic', required: true },
    palette: { type: String, enum: PALETTES, default: 'ivory', required: true },
    look: { type: lookSchema, default: () => ({}) },
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
