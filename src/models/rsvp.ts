import { type InferSchemaType, Schema, model } from 'mongoose'

const rsvpSchema = new Schema(
  {
    weddingId: { type: Schema.Types.ObjectId, ref: 'Wedding', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    attending: { type: Boolean, required: true },
    // Set when the couple rejects the guest. `attending` keeps what the guest said, so undoing it is simple.
    rejectedAt: Date,
    rejectionNote: { type: String, trim: true, maxlength: 300 },
    // Whose side the guest is on: set from the partner's share link, or corrected by the couple.
    sideUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    sideSource: { type: String, enum: ['link', 'couple'] },
    // Private link the guest uses to change their reply. Only the hash is stored.
    editTokenHash: { type: String, required: true, unique: true },
    editExpiresAt: { type: Date, required: true },
    editRevokedAt: Date,
    // The extra link from the guest's latest resend. Their first link keeps working alongside it.
    resendTokenHash: { type: String, index: { unique: true, partialFilterExpression: { resendTokenHash: { $type: 'string' } } } },
    // When a link was last emailed because someone replied again with this address.
    linkResentAt: Date,
  },
  { timestamps: true },
)

// One reply per email per wedding.
rsvpSchema.index({ weddingId: 1, email: 1 }, { unique: true })
rsvpSchema.index({ weddingId: 1, createdAt: -1 })

export type RsvpDoc = InferSchemaType<typeof rsvpSchema>
export const Rsvp = model('Rsvp', rsvpSchema)

/** What a reply counts as. Use this for totals: a rejected guest still has `attending` set. */
export const replyKind = (r: Pick<RsvpDoc, 'attending' | 'rejectedAt'>) =>
  r.rejectedAt ? 'rejected' : r.attending ? 'attending' : 'declined'

/** `replyKind` for aggregations. */
export const replyKindExpr = { $cond: ['$rejectedAt', 'rejected', { $cond: ['$attending', 'attending', 'declined'] }] }

/** For aggregations: 1 for a reply that counts as attending, otherwise 0. */
export const attendingExpr = { $cond: [{ $eq: [replyKindExpr, 'attending'] }, 1, 0] }
