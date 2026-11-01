import type { ErrorRequestHandler, RequestHandler } from 'express'
import { z } from 'zod'
import { isProd } from '../config/env.js'
import { HttpError, notFound } from '../lib/httpError.js'

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Route not found'))
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err)

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Invalid request', details: z.flattenError(err) },
    })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code ?? 'error', message: err.message } })
    return
  }

  // Client errors raised by Express itself (malformed JSON, payload too large)
  if (err instanceof Error && 'status' in err && typeof err.status === 'number' && err.status < 500) {
    res.status(err.status).json({ error: { code: 'bad_request', message: 'Malformed request' } })
    return
  }

  req.log.error(err)
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProd ? 'Something went wrong' : err instanceof Error ? err.message : 'Unknown error',
    },
  })
}
