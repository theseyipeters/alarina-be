import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { partnerInviteEmail } from '../lib/emails.js'
import { HttpError } from '../lib/httpError.js'
import { sendMail } from '../lib/mailer.js'
import { coupleDto, loadCouple } from '../lib/serializers.js'
import { newToken } from '../lib/tokens.js'
import { requireAuth } from '../middleware/auth.js'
import { inviteCreateLimiter } from '../middleware/rateLimit.js'
import { Invite } from '../models/invite.js'

export const coupleRouter = Router()

coupleRouter.use(requireAuth)

coupleRouter.get('/', async (req, res) => {
  const { user } = req.auth!
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ couple: await coupleDto(couple, user._id) })
})

const inviteBody = z.object({ email: z.email().max(254).optional() })

// Creating a new invite revokes any earlier pending one, so only the latest link works.
// The raw token is returned once; only its hash is stored.
coupleRouter.post('/invites', inviteCreateLimiter, async (req, res) => {
  const { user } = req.auth!
  const { email } = inviteBody.parse(req.body ?? {})

  const couple = await loadCouple(user.coupleId).orFail()
  if (couple.members.length > 1) throw new HttpError(409, 'Your partner has already joined', 'already_partnered')

  await Invite.updateMany(
    { coupleId: couple._id, usedAt: null, revokedAt: null },
    { revokedAt: new Date() },
  )

  const { token, tokenHash } = newToken()
  const expiresAt = new Date(Date.now() + env.INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
  await Invite.create({ coupleId: couple._id, invitedBy: user._id, tokenHash, email, expiresAt })

  const link = `${env.CLIENT_ORIGIN}/partner/accept/${token}`
  const emailSent = email
    ? await sendMail({ to: email, ...partnerInviteEmail({ inviterName: user.name, link, expiresAt }) })
    : false

  res.status(201).json({ link, expiresAt, emailSent })
})
