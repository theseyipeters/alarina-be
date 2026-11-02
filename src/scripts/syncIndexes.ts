import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../db/connect.js'
import '../models/adminSession.js'
import '../models/adminUser.js'
import '../models/auditLog.js'
import '../models/contribution.js'
import '../models/giftUnlock.js'
import '../models/itemImage.js'
import '../models/couple.js'
import '../models/invite.js'
import '../models/rsvp.js'
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
