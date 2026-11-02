import type { HydratedDocument } from 'mongoose'
import { Couple, type CoupleDoc } from '../models/couple.js'
import { Invite } from '../models/invite.js'
import { User, type UserDoc } from '../models/user.js'

export const userDto = (user: HydratedDocument<UserDoc>) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  tourCompletedAt: user.tourCompletedAt ?? null,
})

/** The signed-in user's view of their couple space: who the partner is, or whether an invite is pending. */
export async function coupleDto(couple: HydratedDocument<CoupleDoc>, viewerId: unknown) {
  const partnerId = couple.members.find((m) => String(m) !== String(viewerId))
  const partner = partnerId ? await User.findById(partnerId) : null
  const pendingInvite = partner
    ? null
    : await Invite.findOne({
        coupleId: couple._id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 })

  return {
    id: String(couple._id),
    partner: partner ? { name: partner.name, email: partner.email } : null,
    pendingInvite: pendingInvite ? { email: pendingInvite.email ?? null, expiresAt: pendingInvite.expiresAt } : null,
  }
}

export const loadCouple = (coupleId: unknown) => Couple.findById(coupleId)
