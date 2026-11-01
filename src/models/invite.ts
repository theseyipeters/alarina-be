import { Schema, model } from 'mongoose'

const inviteSchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    usedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
  },
  { timestamps: true },
)

export const Invite = model('Invite', inviteSchema)
