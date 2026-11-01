import { Schema, model } from 'mongoose'

// Only the SHA-256 of the cookie token is stored, so a database leak cannot be replayed.
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const Session = model('Session', sessionSchema)
