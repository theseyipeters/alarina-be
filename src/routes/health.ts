import { Router } from 'express'
import { dbReady } from '../db/connect.js'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  const db = dbReady()
  res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down' })
})
