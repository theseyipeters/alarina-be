import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../db/transaction.js'
import { HttpError } from '../lib/httpError.js'
import { coupleDto, loadCouple, userDto } from '../lib/serializers.js'
import { hashToken } from '../lib/tokens.js'
import { requireAuth } from '../middleware/auth.js'
import { inviteLookupLimiter } from '../middleware/rateLimit.js'
import { Couple } from '../models/couple.js'
import { Invite } from '../models/invite.js'
import { User } from '../models/user.js'
import { Wedding } from '../models/wedding.js'

export const invitesRouter = Router()

const invalidInvite = () => new HttpError(404, 'This invite link is invalid or has expired', 'invite_invalid')

const usable = (tokenHash: string) => ({
  tokenHash,
  usedAt: null,
  revokedAt: null,
  expiresAt: { $gt: new Date() },
})

// Public: lets the accept page show who is inviting before the visitor signs in.
invitesRouter.get('/:token', inviteLookupLimiter, async (req, res) => {
  const invite = await Invite.findOne(usable(hashToken(String(req.params.token))))
  if (!invite) throw invalidInvite()
  const inviter = await User.findById(invite.invitedBy)
  res.json({ inviterName: inviter?.name ?? null, expiresAt: invite.expiresAt })
})

const acceptBody = z.object({ discardOwnWedding: z.boolean().optional() })

invitesRouter.post('/:token/accept', requireAuth, inviteLookupLimiter, async (req, res) => {
  const tokenHash = hashToken(String(req.params.token))
  const userId = req.auth!.user._id
  const { discardOwnWedding } = acceptBody.parse(req.body ?? {})

  await withTransaction(async (session) => {
    const user = await User.findById(userId).session(session).orFail()

    // Atomic claim: concurrent accepts can't both succeed, and a failure below rolls this back.
    const invite = await Invite.findOneAndUpdate(
      usable(tokenHash),
      { usedAt: new Date(), usedBy: user._id },
      { session, new: true },
    )
    if (!invite) throw invalidInvite()

    if (String(invite.coupleId) === String(user.coupleId)) {
      throw new HttpError(409, 'You are already in this couple space', 'already_member')
    }

    const ownCouple = await Couple.findById(user.coupleId).session(session).orFail()
    if (ownCouple.members.length > 1) {
      throw new HttpError(409, 'You are already partnered with someone else', 'already_partnered')
    }

    // Joining replaces the partner's own space. A draft they started can be discarded only with
    // explicit confirmation; a published invitation is never thrown away.
    const ownWedding = await Wedding.findOne({ coupleId: ownCouple._id }).session(session)
    if (ownWedding?.status === 'published') {
      throw new HttpError(
        409,
        'You have already published your own invitation, so you can’t join another wedding space',
        'own_wedding_published',
      )
    }
    if (ownWedding && !discardOwnWedding) {
      throw new HttpError(
        409,
        'You have started your own wedding setup. Joining will discard it.',
        'own_wedding_draft',
      )
    }

    // The 'members.1' guard makes the "at most two partners" rule hold under concurrency.
    const joined = await Couple.findOneAndUpdate(
      { _id: invite.coupleId, 'members.1': { $exists: false } },
      { $push: { members: user._id } },
      { session, new: true },
    )
    if (!joined) throw new HttpError(409, 'This couple space already has two partners', 'couple_full')

    user.coupleId = invite.coupleId
    await user.save({ session })

    if (ownWedding) await Wedding.deleteOne({ _id: ownWedding._id }, { session })
    await Couple.deleteOne({ _id: ownCouple._id }, { session })
  })

  const user = await User.findById(userId).orFail()
  const couple = await loadCouple(user.coupleId).orFail()
  res.json({ user: userDto(user), couple: await coupleDto(couple, user._id) })
})
