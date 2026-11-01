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
import { healthRouter } from './routes/health.js'
import { invitesRouter } from './routes/invites.js'
import { weddingRouter } from './routes/wedding.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(pinoHttp({ logger }))
  app.use(helmet())
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
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
  app.use('/api', api)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
