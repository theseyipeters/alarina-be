import type { RequestHandler } from 'express'
import { HttpError } from '../lib/httpError.js'
import { Wedding } from '../models/wedding.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Changes under /wedding/gifts need the one-time unlock payment. Reading is allowed, so the locked
 * page can still draw itself behind the unlock prompt.
 */
export const requireGiftsUnlocked: RequestHandler = async (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.auth) return next()
  const wedding = await Wedding.findOne({ coupleId: req.auth.user.coupleId })
  if (wedding && !wedding.giftsUnlockedAt) {
    throw new HttpError(402, 'Unlock Gifts to use this', 'gifts_locked')
  }
  next()
}
