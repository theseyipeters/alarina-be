import { type InferSchemaType, Schema, model } from 'mongoose'

// A guest's payment to the couple: a cash gift or an aso-ebi order (`kind`; records from before
// aso-ebi have no kind and are cash). Amounts are in kobo: `amount` is what the couple receives, `fee` what the
// guest paid on top for Paystack, and `charge` the total the guest was charged.
// What an aso-ebi order was for, as it stood at checkout, so later edits to the item don't change it.
const asoEbiOrderSchema = new Schema(
  {
    itemId: { type: String, required: true },
    itemName: { type: String, required: true },
    unit: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true },
    phone: { type: String, required: true },
  },
  { _id: false },
)

const contributionSchema = new Schema(
  {
    kind: { type: String, enum: ['cash', 'aso_ebi'], default: 'cash', required: true },
    asoEbi: { type: asoEbiOrderSchema, required: false },
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true },
    rsvpId: { type: Schema.Types.ObjectId, ref: 'Rsvp' },
    guestName: { type: String, required: true, trim: true },
    guestEmail: { type: String, required: true, lowercase: true, trim: true },
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
export const Contribution = model('Contribution', contributionSchema)
