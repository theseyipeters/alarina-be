import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { ADMIN_COOKIE, clearAdminCookie, startAdminSession } from '../../lib/adminSessions.js'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/httpError.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { hashToken } from '../../lib/tokens.js'
import { requireAdmin } from '../../middleware/adminAuth.js'
import { adminAuthLimiter } from '../../middleware/rateLimit.js'
import { AdminSession } from '../../models/adminSession.js'
import { AdminUser, type AdminUserDoc } from '../../models/adminUser.js'

export const adminAuthRouter = Router()

export const adminDto = (a: HydratedDocument<AdminUserDoc>) => ({
  id: String(a._id),
  name: a.name,
  email: a.email,
})

const signinBody = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) })

adminAuthRouter.post('/signin', adminAuthLimiter, async (req, res) => {
  const { email, password } = signinBody.parse(req.body)
  const admin = await AdminUser.findOne({ email: email.toLowerCase() })

  if (!(await verifyPassword(admin?.passwordHash ?? undefined, password)) || !admin) {
    throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials')
  }
  // Only said once the password is right, so it doesn't reveal which addresses are staff.
  if (admin.disabledAt) throw new HttpError(403, 'This staff account has been disabled', 'account_disabled')

  admin.lastSignInAt = new Date()
  await admin.save()
  await startAdminSession(res, admin._id)
  req.admin = { user: admin, sessionId: '' }
  await audit(req, 'admin.signin')
  res.json({ admin: adminDto(admin) })
})

adminAuthRouter.post('/signout', async (req, res) => {
  const token: unknown = req.cookies?.[ADMIN_COOKIE]
  if (typeof token === 'string') await AdminSession.deleteOne({ tokenHash: hashToken(token) })
  clearAdminCookie(res)
  res.status(204).end()
})

// Always 200, so the admin app can tell signed-out from broken without a noisy 401.
adminAuthRouter.get('/me', (req, res) => {
  res.json({ admin: req.admin ? adminDto(req.admin.user) : null })
})

const passwordBody = z.object({ current: z.string().min(1).max(128), password: z.string().min(12).max(128) })

// Changing your own password signs you out everywhere else.
adminAuthRouter.post('/password', requireAdmin, adminAuthLimiter, async (req, res) => {
  const { current, password } = passwordBody.parse(req.body)
  const admin = req.admin!.user
  if (!(await verifyPassword(admin.passwordHash ?? undefined, current))) {
    throw new HttpError(400, 'Your current password is incorrect', 'invalid_password')
  }
  admin.passwordHash = await hashPassword(password)
  await admin.save()
  await AdminSession.deleteMany({ adminId: admin._id, _id: { $ne: req.admin!.sessionId } })
  await audit(req, 'admin.password_changed')
  res.json({ ok: true })
})

const findBySetupToken = (token: string) =>
  AdminUser.findOne({ setupTokenHash: hashToken(token), setupExpiresAt: { $gt: new Date() }, disabledAt: null })

const setupInvalid = () =>
  new HttpError(404, 'This setup link has expired or has already been used. Ask a teammate for a new one.', 'setup_link_invalid')

// Lets the setup page greet the person, or say straight away that the link is dead.
adminAuthRouter.get('/setup/:token', adminAuthLimiter, async (req, res) => {
  const admin = await findBySetupToken(String(req.params.token))
  if (!admin) throw setupInvalid()
  res.json({ name: admin.name, email: admin.email })
})

const setupBody = z.object({ token: z.string().min(1).max(200), password: z.string().min(12).max(128) })

// Sets the password from a setup link (new staff, or a reset by a teammate) and signs in.
adminAuthRouter.post('/setup', adminAuthLimiter, async (req, res) => {
  const { token, password } = setupBody.parse(req.body)
  const passwordHash = await hashPassword(password)
  const admin = await AdminUser.findOneAndUpdate(
    { setupTokenHash: hashToken(token), setupExpiresAt: { $gt: new Date() }, disabledAt: null },
    { $set: { passwordHash, lastSignInAt: new Date() }, $unset: { setupTokenHash: 1, setupExpiresAt: 1 } },
    { returnDocument: 'after' },
  )
  if (!admin) throw setupInvalid()

  await AdminSession.deleteMany({ adminId: admin._id })
  await startAdminSession(res, admin._id)
  req.admin = { user: admin, sessionId: '' }
  await audit(req, 'admin.password_changed', { meta: { via: 'setup_link' } })
  res.json({ admin: adminDto(admin) })
})
