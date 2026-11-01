import mongoose from 'mongoose'
import { env, isProd } from '../config/env.js'
import { logger } from '../config/logger.js'

export async function connectDb() {
  // In production indexes are created deliberately (`yarn db:sync-indexes`), not on every boot.
  mongoose.set('autoIndex', !isProd)
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected')
}

export async function disconnectDb() {
  await mongoose.disconnect()
}

export const dbReady = () => mongoose.connection.readyState === mongoose.ConnectionStates.connected
