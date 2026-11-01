import { type InferSchemaType, Schema, model } from 'mongoose'

// A couple space is shared by at most two partners.
const coupleSchema = new Schema(
  {
    members: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      validate: (v: unknown[]) => v.length >= 1 && v.length <= 2,
    },
  },
  { timestamps: true },
)

export type CoupleDoc = InferSchemaType<typeof coupleSchema>
export const Couple = model('Couple', coupleSchema)
