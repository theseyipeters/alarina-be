import { type InferSchemaType, Schema, model } from 'mongoose'

const rsvpSchema = new Schema(
  {
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    attending: { type: Boolean, required: true },
    // Whose side the guest is on: set from the partner's share link, or corrected by the couple.
    sideUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    sideSource: { type: String, enum: ['link', 'couple'] },
    // Private link the guest uses to change their reply. Only the hash is stored.
    editTokenHash: { type: String, required: true, unique: true },
    editExpiresAt: { type: Date, required: true },
    editRevokedAt: Date,
  },
  { timestamps: true },
)

// One reply per email per wedding.
rsvpSchema.index({ weddingId: 1, email: 1 }, { unique: true })
rsvpSchema.index({ weddingId: 1, createdAt: -1 })

export type RsvpDoc = InferSchemaType<typeof rsvpSchema>
export const Rsvp = model('Rsvp', rsvpSchema)
