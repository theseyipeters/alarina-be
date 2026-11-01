import { type InferSchemaType, Schema, model } from 'mongoose'

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
  },
  { timestamps: true },
)

export type UserDoc = InferSchemaType<typeof userSchema>
export const User = model('User', userSchema)
