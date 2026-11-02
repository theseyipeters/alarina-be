import { Schema, model } from 'mongoose'

// One "forgot password" link. Only the token's hash is stored; the link works once, until
// expiresAt, after which MongoDB deletes the record (TTL index).
const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const PasswordReset = model('PasswordReset', passwordResetSchema)
