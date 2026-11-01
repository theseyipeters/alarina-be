import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { connectDb, disconnectDb } from './db/connect.js'

await connectDb()

const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`)
})

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down`)
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
