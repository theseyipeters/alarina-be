import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { ADMIN_COOKIE } from '../lib/adminSessions.js'
import { HttpError } from '../lib/httpError.js'
import { hashToken } from '../lib/tokens.js'
import { AdminSession } from '../models/adminSession.js'
import { AdminUser } from '../models/adminUser.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The admin API exists only when ADMIN_ORIGIN is set. */
export const adminEnabled: RequestHandler = (_req, _res, next) => {
  if (!env.ADMIN_ORIGIN) return next(new HttpError(404, 'Route not found', 'not_found'))
  next()
}

/** Like enforceOrigin, for the admin app: changes must come from ADMIN_ORIGIN. */
export const enforceAdminOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.get('origin') !== env.ADMIN_ORIGIN) {
    return next(new HttpError(403, 'Request origin not allowed', 'bad_origin'))
  }
  next()
}

/** Attaches `req.admin` when the staff cookie is valid and the account is active. Never rejects. */
export const loadAdmin: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[ADMIN_COOKIE]
  if (typeof token !== 'string' || !token) return next()

  const session = await AdminSession.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
  const admin = session && (await AdminUser.findById(session.adminId))
  if (session && admin && !admin.disabledAt) req.admin = { user: admin, sessionId: String(session._id) }
  next()
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.admin) return next(new HttpError(401, 'Sign in to continue', 'unauthenticated'))
  next()
}
