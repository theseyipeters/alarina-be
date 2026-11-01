import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../db/connect.js'
import '../models/couple.js'
import '../models/invite.js'
import '../models/session.js'
import '../models/user.js'
import '../models/wedding.js'

// Creates missing indexes. Unlike `syncIndexes()`, it never drops existing ones (additive only).
await connectDb()
for (const model of Object.values(mongoose.models)) {
  await model.createIndexes()
  console.log(`indexes ensured: ${model.modelName}`)
}
await disconnectDb()
