import type { RequestHandler } from 'express'
import { HttpError } from '../lib/httpError.js'
import { isSuspended } from '../lib/suspension.js'
import { SESSION_COOKIE } from '../lib/sessions.js'
import { hashToken } from '../lib/tokens.js'
import { Session } from '../models/session.js'
import { User } from '../models/user.js'

/** Attaches `req.auth` when the session cookie is valid. Never rejects. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string' || !token) return next()

  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
  const user = session && (await User.findById(session.userId))
  // A suspended couple's sessions are ended when staff suspend them; this also covers any opened since.
  if (session && user && !(await isSuspended(user.coupleId))) req.auth = { user, sessionId: String(session._id) }
  next()
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new HttpError(401, 'Sign in to continue', 'unauthenticated'))
  next()
}
