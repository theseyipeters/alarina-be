import { type InferSchemaType, Schema, model } from 'mongoose'

// A couple's one-time payment to Alárinà to use Gifts. It goes to Alárinà's own Paystack account,
// not the couple's subaccount. Amounts are in kobo.
const giftUnlockSchema = new Schema(
  {
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true, index: true },
    charge: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'success', 'failed', 'abandoned'], default: 'pending', required: true },
    paidAt: Date,
  },
  { timestamps: true },
)

export type GiftUnlockDoc = InferSchemaType<typeof giftUnlockSchema>
export const GiftUnlock = model('GiftUnlock', giftUnlockSchema)
