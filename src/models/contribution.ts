import { type InferSchemaType, type QueryFilter, Schema, model } from 'mongoose'

// One thing a guest gave within a payment. `amount` is what the couple receives for it, in kobo.
// An aso-ebi line keeps the item as it stood at checkout, so later edits to the item don't change it.
const lineSchema = new Schema(
  {
    kind: { type: String, enum: ['cash', 'aso_ebi'], required: true },
    amount: { type: Number, required: true },
    itemId: String,
    itemName: String,
    unit: String,
    unitPrice: Number,
    quantity: Number,
  },
  { _id: false },
)

// A guest's payment to the couple: one Paystack checkout covering a basket of `lines`. Amounts are
// in kobo: `amount` is what the couple receives (the sum of the lines), `fee` what the guest paid
// on top for Paystack, and `charge` the total the guest was charged. Payments from before baskets
// have no lines and are a single cash gift of `amount`.
const contributionSchema = new Schema(
  {
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true },
    rsvpId: { type: Schema.Types.ObjectId, ref: 'Rsvp' },
    guestName: { type: String, required: true, trim: true },
    guestEmail: { type: String, required: true, lowercase: true, trim: true },
    // Needed when the basket has aso-ebi, so the couple can reach the guest about their order.
    guestPhone: String,
    lines: { type: [lineSchema], default: [] },
    amount: { type: Number, required: true },
    fee: { type: Number, required: true },
    charge: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'success', 'failed', 'abandoned'], default: 'pending', required: true },
    paidAt: Date,
  },
  { timestamps: true },
)

contributionSchema.index({ weddingId: 1, createdAt: -1 })

export type ContributionDoc = InferSchemaType<typeof contributionSchema>
export type Line = InferSchemaType<typeof lineSchema>
export const Contribution = model('Contribution', contributionSchema)

/** The lines of a payment; older payments without any are one cash gift. */
export const linesOf = (c: Pick<ContributionDoc, 'lines' | 'amount'>): Line[] =>
  c.lines?.length ? c.lines : [{ kind: 'cash', amount: c.amount }]

/** Mongo filters for payments that include a cash gift, or aso-ebi. Older payments have no `lines` field. */
export const hasCash = {
  $or: [{ lines: { $exists: false } }, { lines: { $size: 0 } }, { 'lines.kind': 'cash' }],
} as QueryFilter<ContributionDoc>
export const hasAsoEbi = { 'lines.kind': 'aso_ebi' } as QueryFilter<ContributionDoc>
