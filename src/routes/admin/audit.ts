import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { AUDIT_ACTIONS, AuditLog, type AuditLogDoc } from '../../models/auditLog.js'
import { objectId, PAGE_SIZE, pageQuery, paginate } from './shared.js'

export const adminAuditRouter = Router()

export const auditDto = (a: HydratedDocument<AuditLogDoc>) => ({
  id: String(a._id),
  action: a.action,
  admin: { id: String(a.adminId), name: a.adminName, email: a.adminEmail },
  coupleId: a.coupleId ? String(a.coupleId) : null,
  targetType: a.targetType ?? null,
  targetId: a.targetId ?? null,
  targetLabel: a.targetLabel ?? null,
  reason: a.reason ?? null,
  meta: a.meta ?? null,
  createdAt: a.createdAt,
})

const listQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  admin: z.string().max(40).optional().catch(undefined),
  // Sign-ins are routine; they're left out unless asked for.
  signins: z.stringbool().catch(false),
  page: pageQuery,
})

adminAuditRouter.get('/audit', async (req, res) => {
  const { action, admin, signins, page } = listQuery.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (action) filter.action = action
  else if (!signins) filter.action = { $ne: 'admin.signin' }
  if (admin) filter.adminId = objectId(admin, 'staff member')

  const { skip, limit } = paginate(page)
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ])
  res.json({ items: items.map(auditDto), total, page, pageSize: PAGE_SIZE, actions: AUDIT_ACTIONS })
})
