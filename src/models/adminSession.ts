import { Schema, model } from 'mongoose'

// A staff sign-in. Separate from couples' sessions and shorter-lived. Only the token's hash is stored.
const adminSessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const AdminSession = model('AdminSession', adminSessionSchema)
