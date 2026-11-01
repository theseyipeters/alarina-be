import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { isDuplicateKeyError, withTransaction } from '../db/transaction.js'
import { HttpError } from '../lib/httpError.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { coupleDto, loadCouple, userDto } from '../lib/serializers.js'
import { clearSessionCookie, SESSION_COOKIE, startSession } from '../lib/sessions.js'
import { hashToken } from '../lib/tokens.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { Couple } from '../models/couple.js'
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
