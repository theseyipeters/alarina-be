import { type InferSchemaType, Schema, model } from 'mongoose'

// Alárinà staff who use the admin app. Kept apart from couples' accounts, so a couple can never
// become staff by accident. Everyone has the same powers; every action they take is audit-logged.
// A new staff member has no password until they open their setup link (only its hash is stored).
const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: String,
    setupTokenHash: { type: String, index: { unique: true, partialFilterExpression: { setupTokenHash: { $type: 'string' } } } },
    setupExpiresAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    lastSignInAt: Date,
    // Disabled staff can't sign in; their sessions are ended when this is set.
    disabledAt: Date,
  },
  { timestamps: true },
)

export type AdminUserDoc = InferSchemaType<typeof adminUserSchema>
export const AdminUser = model('AdminUser', adminUserSchema)
