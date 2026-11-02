import type { CookieOptions, Response } from 'express'
import type { Types } from 'mongoose'
import { env, isProd } from '../config/env.js'
import { AdminSession } from '../models/adminSession.js'
import { newToken } from './tokens.js'

// Staff sign-ins use their own cookie, sent only to the admin API, so a couple's session and a
// staff session never mix even in the same browser.
export const ADMIN_COOKIE = 'alarina_admin'

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: isProd,
  path: '/api/admin',
}

export async function startAdminSession(res: Response, adminId: Types.ObjectId) {
  const { token, tokenHash } = newToken()
  const maxAge = env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000
  await AdminSession.create({ tokenHash, adminId, expiresAt: new Date(Date.now() + maxAge) })
  res.cookie(ADMIN_COOKIE, token, { ...cookieOptions, maxAge })
}

export const clearAdminCookie = (res: Response) => res.clearCookie(ADMIN_COOKIE, cookieOptions)

/** How long a new staff member's setup link (or a fresh one) works. */
export const SETUP_TTL_HOURS = 72

export const setupLink = (token: string) => `${env.ADMIN_ORIGIN}/setup/${token}`
