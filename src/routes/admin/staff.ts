import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { isDuplicateKeyError } from '../../db/transaction.js'
import { SETUP_TTL_HOURS, setupLink } from '../../lib/adminSessions.js'
import { audit } from '../../lib/audit.js'
import { staffSetupEmail } from '../../lib/emails.js'
import { HttpError } from '../../lib/httpError.js'
import { sendMail } from '../../lib/mailer.js'
import { newToken } from '../../lib/tokens.js'
import { AdminSession } from '../../models/adminSession.js'
import { AdminUser, type AdminUserDoc } from '../../models/adminUser.js'
import { objectId } from './shared.js'

// Alárinà staff. Everyone has the same powers, including adding and disabling teammates.
export const adminStaffRouter = Router()

const staffDto = (a: HydratedDocument<AdminUserDoc>, viewerId: unknown) => ({
  id: String(a._id),
  name: a.name,
  email: a.email,
  createdAt: a.createdAt,
  lastSignInAt: a.lastSignInAt ?? null,
  disabledAt: a.disabledAt ?? null,
  // Added but hasn't chosen a password yet.
  pendingSetup: !a.passwordHash,
  setupExpiresAt: a.setupExpiresAt ?? null,
  isYou: String(a._id) === String(viewerId),
})

adminStaffRouter.get('/staff', async (req, res) => {
  const staff = await AdminUser.find().sort({ disabledAt: 1, createdAt: 1 })
  res.json({ staff: staff.map((a) => staffDto(a, req.admin!.user._id)) })
})

/** Gives the staff member a fresh setup link, emails it, and returns it so it can be passed on by hand. */
async function issueSetupLink(admin: HydratedDocument<AdminUserDoc>, invitedBy: string) {
  const { token, tokenHash } = newToken()
  admin.setupTokenHash = tokenHash
  admin.setupExpiresAt = new Date(Date.now() + SETUP_TTL_HOURS * 60 * 60 * 1000)
  await admin.save()
  const link = setupLink(token)
  const emailSent = await sendMail({
    to: admin.email,
    ...staffSetupEmail({ name: admin.name, invitedBy, link, expiresAt: admin.setupExpiresAt }),
  })
  return { link, expiresAt: admin.setupExpiresAt, emailSent }
}

const createBody = z.object({ name: z.string().trim().min(1).max(80), email: z.email().max(254) })

adminStaffRouter.post('/staff', async (req, res) => {
  const { name, email } = createBody.parse(req.body)
  let admin: HydratedDocument<AdminUserDoc>
  try {
    admin = await AdminUser.create({ name, email: email.toLowerCase(), createdBy: req.admin!.user._id })
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new HttpError(409, 'Someone with this email is already staff', 'email_taken')
    throw err
  }
  const setup = await issueSetupLink(admin, req.admin!.user.name)
  await audit(req, 'staff.created', { targetType: 'staff', targetId: admin._id, targetLabel: `${admin.name} (${admin.email})` })
  res.status(201).json({ staff: staffDto(admin, req.admin!.user._id), setup })
})

async function findStaff(id: unknown) {
  const admin = await AdminUser.findById(objectId(id, 'staff member'))
  if (!admin) throw new HttpError(404, 'We couldn’t find that staff member', 'not_found')
  return admin
}

// A new link for someone who lost theirs, or forgot their password. Their old password keeps
// working until they use it.
adminStaffRouter.post('/staff/:id/setup-link', async (req, res) => {
  const admin = await findStaff(req.params.id)
  if (admin.disabledAt) throw new HttpError(409, 'Enable this account first', 'account_disabled')
  const setup = await issueSetupLink(admin, req.admin!.user.name)
  await audit(req, 'staff.setup_link', { targetType: 'staff', targetId: admin._id, targetLabel: `${admin.name} (${admin.email})` })
  res.json({ staff: staffDto(admin, req.admin!.user._id), setup })
})

adminStaffRouter.post('/staff/:id/disable', async (req, res) => {
  const admin = await findStaff(req.params.id)
  if (String(admin._id) === String(req.admin!.user._id)) {
    throw new HttpError(409, 'You can’t disable your own account. Ask a teammate.', 'cannot_disable_self')
  }
  if (admin.disabledAt) throw new HttpError(409, 'This account is already disabled', 'already_disabled')
  admin.disabledAt = new Date()
  admin.setupTokenHash = undefined
  admin.setupExpiresAt = undefined
  await admin.save()
  await AdminSession.deleteMany({ adminId: admin._id })
  await audit(req, 'staff.disabled', { targetType: 'staff', targetId: admin._id, targetLabel: `${admin.name} (${admin.email})` })
  res.json({ staff: staffDto(admin, req.admin!.user._id) })
})

adminStaffRouter.post('/staff/:id/enable', async (req, res) => {
  const admin = await findStaff(req.params.id)
  if (!admin.disabledAt) throw new HttpError(409, 'This account is already active', 'already_active')
  admin.disabledAt = undefined
  await admin.save()
  await audit(req, 'staff.enabled', { targetType: 'staff', targetId: admin._id, targetLabel: `${admin.name} (${admin.email})` })
  res.json({ staff: staffDto(admin, req.admin!.user._id) })
})
