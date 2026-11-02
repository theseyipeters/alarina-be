import type { Request } from 'express'
import type { Types } from 'mongoose'
import { AuditLog, type AuditAction } from '../models/auditLog.js'

type Entry = {
  coupleId?: Types.ObjectId | string | null
  targetType?: 'couple' | 'payment' | 'unlock' | 'staff'
  targetId?: unknown
  targetLabel?: string
  reason?: string
  meta?: Record<string, unknown>
}

/** Records what the signed-in staff member just did. Call after the change has been made. */
export async function audit(req: Request, action: AuditAction, entry: Entry = {}) {
  const admin = req.admin!.user
  await AuditLog.create({
    adminId: admin._id,
    adminName: admin.name,
    adminEmail: admin.email,
    action,
    ...(entry.coupleId && { coupleId: entry.coupleId }),
    ...(entry.targetType && { targetType: entry.targetType }),
    ...(entry.targetId != null && { targetId: String(entry.targetId) }),
    ...(entry.targetLabel && { targetLabel: entry.targetLabel }),
    ...(entry.reason && { reason: entry.reason }),
    ...(entry.meta && { meta: entry.meta }),
  })
}
