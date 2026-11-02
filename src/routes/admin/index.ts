import { Router } from 'express'
import { notFound } from '../../lib/httpError.js'
import { adminEnabled, enforceAdminOrigin, loadAdmin, requireAdmin } from '../../middleware/adminAuth.js'
import { adminAuditRouter } from './audit.js'
import { adminAuthRouter } from './auth.js'
import { adminCouplesRouter } from './couples.js'
import { adminOverviewRouter } from './overview.js'
import { adminPaymentsRouter } from './payments.js'
import { adminStaffRouter } from './staff.js'

// The staff admin app's API, mounted at /api/admin. It has its own origin, cookie and sessions,
// separate from the couples' app. Everything but signing in needs a staff session.
export const adminRouter = Router()

adminRouter.use(adminEnabled)
adminRouter.use(enforceAdminOrigin)
adminRouter.use(loadAdmin)
adminRouter.use('/auth', adminAuthRouter)
adminRouter.use(requireAdmin)
adminRouter.use(adminOverviewRouter)
adminRouter.use(adminCouplesRouter)
adminRouter.use(adminPaymentsRouter)
adminRouter.use(adminAuditRouter)
adminRouter.use(adminStaffRouter)
// Stop here, so unknown admin paths don't fall through to the couples' API.
adminRouter.use((_req, _res, next) => next(notFound('Route not found')))
