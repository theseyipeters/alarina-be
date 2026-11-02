import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { env } from '../config/env.js'

const limiter = (windowMs: number, limit: number, message: string, perUser = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: (req) => (perUser && req.auth ? String(req.auth.user._id) : ipKeyGenerator(req.ip ?? '')),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } })
    },
  })

const MINUTE = 60 * 1000

export const authLimiter = limiter(15 * MINUTE, 20, 'Too many attempts. Try again in a few minutes.')
// Each request can send an email, so this is tighter than sign-in.
export const passwordResetLimiter = limiter(15 * MINUTE, 5, 'Too many reset requests. Try again in a few minutes.')
export const inviteCreateLimiter = limiter(60 * MINUTE, 10, 'Too many invites created. Try again later.', true)
export const inviteLookupLimiter = limiter(15 * MINUTE, 60, 'Too many requests. Try again in a few minutes.')
export const rsvpCreateLimiter = limiter(15 * MINUTE, 20, 'Too many replies from this connection. Try again later.')
export const publicLookupLimiter = limiter(15 * MINUTE, 120, 'Too many requests. Try again in a few minutes.')
export const giftCreateLimiter = limiter(15 * MINUTE, 20, 'Too many gift attempts. Try again in a few minutes.')
export const accountLookupLimiter = limiter(60 * MINUTE, 30, 'Too many account checks. Try again later.', true)
