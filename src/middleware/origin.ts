import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Rejects state-changing requests that don't come from our own frontend (CSRF defence in depth). */
export const enforceOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.get('origin') !== env.CLIENT_ORIGIN) {
    return next(new HttpError(403, 'Request origin not allowed', 'bad_origin'))
  }
  next()
}
