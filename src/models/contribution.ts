import { type InferSchemaType, Schema, model } from 'mongoose'

// A guest's cash gift. Amounts are in kobo: `amount` is what the couple receives, `fee` what the
// guest paid on top for Paystack, and `charge` the total the guest was charged.
const contributionSchema = new Schema(
  {
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
