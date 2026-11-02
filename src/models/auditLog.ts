import { type InferSchemaType, Schema, model } from 'mongoose'

export const AUDIT_ACTIONS = [
  'admin.signin',
  'admin.password_changed',
  'staff.created',
  'staff.setup_link',
  'staff.disabled',
  'staff.enabled',
  'couple.suspended',
  'couple.restored',
  'couple.signed_out',
  'gifts.unlocked',
  'gifts.locked',
  'payment.rechecked',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

// What staff did, and to whom. Written once and never edited. The staff member's name and email
// are copied in, so the trail still reads correctly if their account changes later.
const auditLogSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    adminName: { type: String, required: true },
    adminEmail: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    // The couple this concerns, if any, so their page can show its own history.
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple' },
    targetType: { type: String, enum: ['couple', 'payment', 'unlock', 'staff'] },
    targetId: String,
    // A short label for the target as it was ("Ada & Tobi", "alr_3f…"), for reading the log.
    targetLabel: String,
    // Why, in the staff member's words. Required for anything that changes a couple's account.
    reason: String,
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ coupleId: 1, createdAt: -1 })

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>
export const AuditLog = model('AuditLog', auditLogSchema)
