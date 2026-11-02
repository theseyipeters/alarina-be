import type { HydratedDocument } from 'mongoose'
import type { AdminUserDoc } from '../models/adminUser.js'
import type { UserDoc } from '../models/user.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `loadSession` when the request carries a valid session cookie. */
    auth?: { user: HydratedDocument<UserDoc>; sessionId: string }
    /** Set by `loadAdmin` on admin routes when the request carries a valid staff session. */
    admin?: { user: HydratedDocument<AdminUserDoc>; sessionId: string }
  }
}
