import type { HydratedDocument } from 'mongoose'
import type { UserDoc } from '../models/user.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `loadSession` when the request carries a valid session cookie. */
    auth?: { user: HydratedDocument<UserDoc>; sessionId: string }
  }
}
