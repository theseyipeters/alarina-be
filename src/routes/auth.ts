import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { isDuplicateKeyError, withTransaction } from '../db/transaction.js'
import { env } from '../config/env.js'
import { passwordChangedEmail, passwordResetEmail, welcomeEmail } from '../lib/emails.js'
import { HttpError } from '../lib/httpError.js'
import { sendMail } from '../lib/mailer.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { coupleDto, loadCouple, userDto } from '../lib/serializers.js'
import { clearSessionCookie, SESSION_COOKIE, startSession } from '../lib/sessions.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { requireAuth } from '../middleware/auth.js'
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit.js'
import { Couple } from '../models/couple.js'
import { PasswordReset } from '../models/passwordReset.js'
import { Session } from '../models/session.js'
import { User } from '../models/user.js'

export const authRouter = Router()

const signupBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
})

const signinBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
})

authRouter.post('/signup', authLimiter, async (req, res) => {
  const { name, email, password } = signupBody.parse(req.body)
  const passwordHash = await hashPassword(password)

  const userId = new mongoose.Types.ObjectId()
  const coupleId = new mongoose.Types.ObjectId()

  try {
    await withTransaction(async (session) => {
      await Couple.create([{ _id: coupleId, members: [userId] }], { session })
      await User.create([{ _id: userId, name, email, passwordHash, coupleId }], { session })
    })
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new HttpError(409, 'An account with this email already exists', 'email_taken')
    throw err
  }

  await startSession(res, userId)
  const user = await User.findById(userId).orFail()
  const couple = await loadCouple(coupleId).orFail()
  res.status(201).json({ user: userDto(user), couple: await coupleDto(couple, userId) })

  // After responding, so sign-up never waits on the email provider. sendMail never throws.
  void sendMail({ to: user.email, ...welcomeEmail({ name: user.name }) })
})

// The dashboard tour was finished or skipped. Kept on the server so it isn't shown again on another device.
authRouter.post('/tour', requireAuth, async (req, res) => {
  const { user } = req.auth!
  user.tourCompletedAt ??= new Date()
  await user.save()
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ user: userDto(user), couple: await coupleDto(couple, user._id) })
})

authRouter.post('/signin', authLimiter, async (req, res) => {
  const { email, password } = signinBody.parse(req.body)
  const user = await User.findOne({ email: email.toLowerCase() })

  if (!(await verifyPassword(user?.passwordHash, password)) || !user) {
    throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials')
  }

  await startSession(res, user._id)
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ user: userDto(user), couple: await coupleDto(couple, user._id) })
})

authRouter.post('/signout', async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string') await Session.deleteOne({ tokenHash: hashToken(token) })
  clearSessionCookie(res)
  res.status(204).end()
})

const RESET_TTL_MINUTES = 60
const resetLinkInvalid = () =>
  new HttpError(404, 'This reset link has expired or has already been used. Request a new one.', 'reset_link_invalid')

// Answers the same way whether or not the address has an account, so this can't be used to find
// out who has signed up. The email is sent without waiting, so the response time doesn't tell either.
authRouter.post('/password/forgot', passwordResetLimiter, async (req, res) => {
  const { email } = z.object({ email: z.email().max(254) }).parse(req.body)
  const user = await User.findOne({ email: email.toLowerCase() })

  if (user) {
    // Only the newest link works.
    await PasswordReset.deleteMany({ userId: user._id, usedAt: null })
    const { token, tokenHash } = newToken()
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000)
    await PasswordReset.create({ userId: user._id, tokenHash, expiresAt })
    const link = `${env.CLIENT_ORIGIN}/reset-password/${token}`
    void sendMail({ to: user.email, ...passwordResetEmail({ name: user.name, link, minutes: RESET_TTL_MINUTES }) })
  }

  res.status(202).json({ ok: true })
})

const findUsableReset = (token: string) =>
  PasswordReset.findOne({ tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } })

// Lets the reset page say straight away when a link is dead, before anyone types a new password.
authRouter.get('/password/reset/:token', authLimiter, async (req, res) => {
  if (!(await findUsableReset(String(req.params.token)))) throw resetLinkInvalid()
  res.json({ ok: true })
})

const resetBody = z.object({ token: z.string().min(1).max(200), password: z.string().min(8).max(128) })

// Sets the new password, uses up the link, signs out every other session, and signs this browser in.
authRouter.post('/password/reset', authLimiter, async (req, res) => {
  const { token, password } = resetBody.parse(req.body)
  const passwordHash = await hashPassword(password)

  const userId = await withTransaction(async (session) => {
    const reset = await PasswordReset.findOneAndUpdate(
      { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
      { usedAt: new Date() },
      { session },
    )
    if (!reset) throw resetLinkInvalid()
    await User.updateOne({ _id: reset.userId }, { passwordHash }, { session })
    await Session.deleteMany({ userId: reset.userId }, { session })
    await PasswordReset.deleteMany({ userId: reset.userId, usedAt: null }, { session })
    return reset.userId
  })

  await startSession(res, userId)
  const user = await User.findById(userId).orFail()
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ user: userDto(user), couple: await coupleDto(couple, user._id) })

  void sendMail({ to: user.email, ...passwordChangedEmail({ name: user.name, changedAt: new Date() }) })
})

// Always 200 so the frontend can bootstrap without a noisy 401 for signed-out visitors.
authRouter.get('/me', async (req, res) => {
  if (!req.auth) {
    res.json({ user: null, couple: null })
    return
  }
  const { user } = req.auth
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ user: userDto(user), couple: await coupleDto(couple, user._id) })
})
