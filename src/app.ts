import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { loadSession } from './middleware/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { enforceOrigin } from './middleware/origin.js'
import { authRouter } from './routes/auth.js'
import { coupleRouter } from './routes/couple.js'
import { asoEbiRouter } from './routes/asoEbi.js'
import { giftsRouter } from './routes/gifts.js'
import { guestsRouter } from './routes/guests.js'
import { healthRouter } from './routes/health.js'
import { invitesRouter } from './routes/invites.js'
import { publicRouter } from './routes/public.js'
import { webhooksRouter } from './routes/webhooks.js'
import { weddingRouter } from './routes/wedding.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  // One line per request ("POST /api/auth/signin 401 45ms · invalid_credentials"). Headers
  // (cookies, auth) are never logged. Only unexpected crashes carry a stack trace: the error
  // handler hands those over as res.err; expected HttpErrors just add their code.
  // Private links (password reset, partner invite, RSVP edit) carry a 43-character token in the
  // path. Mask anything that long so logs never hold a working link.
  const safeUrl = (url: string) => url.replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
  const line = (req: express.Request, res: express.Response, ms?: number) =>
    `${req.method} ${safeUrl(req.originalUrl)} ${res.statusCode}${ms === undefined ? '' : ` ${Math.round(ms)}ms`}${
      res.locals.errorCode ? ` · ${res.locals.errorCode}` : ''
    }`
  app.use(
    pinoHttp({
      logger,
      serializers: { req: () => undefined, res: () => undefined },
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      customSuccessMessage: (req, res, ms) => line(req as express.Request, res as express.Response, ms),
      customErrorMessage: (req, res) => line(req as express.Request, res as express.Response),
      // Drop pino-http's synthetic "failed with status code" error for expected failures.
      customErrorObject: (_req, res, _err, val) => (res.err ? val : { ...val, err: undefined }),
      quietReqLogger: true,
    }),
  )
  app.use(helmet())
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
  // Before the JSON parser: webhooks need the raw body to check their signature.
  app.use('/api/webhooks', webhooksRouter)
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  const api = express.Router()
  api.use(enforceOrigin)
  api.use(loadSession)
  api.use(healthRouter)
  api.use('/auth', authRouter)
  api.use('/couple', coupleRouter)
  api.use('/invites', invitesRouter)
  api.use('/wedding', weddingRouter)
  api.use('/wedding', guestsRouter)
  api.use('/wedding', giftsRouter)
  api.use('/wedding', asoEbiRouter)
  api.use('/public', publicRouter)
  app.use('/api', api)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
