import type { CookieOptions, Response } from 'express'
import type { Types } from 'mongoose'
import { env, isProd } from '../config/env.js'
import { Session } from '../models/session.js'
import { newToken } from './tokens.js'

export const SESSION_COOKIE = 'alarina_session'

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,
  path: '/',
}

export async function startSession(res: Response, userId: Types.ObjectId) {
  const { token, tokenHash } = newToken()
  const maxAge = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  await Session.create({ tokenHash, userId, expiresAt: new Date(Date.now() + maxAge) })
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge })
}

export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieOptions)
