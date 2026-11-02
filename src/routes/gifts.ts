import { Router } from 'express'
import type { HydratedDocument, Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import {
  createSubaccount,
  listBanks,
  paystackConfigured,
  resolveAccount,
  updateSubaccount,
} from '../lib/paystack.js'
import { requireAuth } from '../middleware/auth.js'
import { requireGiftsUnlocked } from '../middleware/giftsUnlocked.js'
import { accountLookupLimiter } from '../middleware/rateLimit.js'
import { Contribution, hasCash, linesOf, type ContributionDoc } from '../models/contribution.js'
import { Wedding } from '../models/wedding.js'

// The couple's side of cash gifts: where the money goes, switching gifts on, and what came in.
export const giftsRouter = Router()

giftsRouter.use(requireAuth)
giftsRouter.use('/gifts', requireGiftsUnlocked)

export async function ownWedding(coupleId: Types.ObjectId) {
  const wedding = await Wedding.findOne({ coupleId })
  if (!wedding) throw new HttpError(404, 'Start your wedding setup first', 'no_wedding')
  return wedding
}

const accountInput = z.object({
  bankCode: z.string().trim().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits'),
})

// A basket can hold more than a cash gift; this is only the cash part.
const cashAmount = (c: HydratedDocument<ContributionDoc>) =>
  linesOf(c).filter((l) => l.kind === 'cash').reduce((sum, l) => sum + l.amount, 0)

const contributionDto = (c: HydratedDocument<ContributionDoc>) => ({
  id: String(c._id),
  guestName: c.guestName,
  guestEmail: c.guestEmail,
  amount: cashAmount(c),
  status: c.status,
  createdAt: c.createdAt,
  paidAt: c.paidAt ?? null,
})

giftsRouter.get('/gifts', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const contributions = await Contribution.find({ weddingId: wedding._id, ...hasCash }).sort({ createdAt: -1 })
  const succeeded = contributions.filter((c) => c.status === 'success')

  res.json({
    configured: paystackConfigured(),
    feesConfirmed: env.PAYSTACK_FEES_CONFIRMED,
    enabled: wedding.giftsEnabled,
    payout: wedding.payout
      ? {
          bankName: wedding.payout.bankName,
          accountName: wedding.payout.accountName,
          accountLast4: wedding.payout.accountLast4,
        }
      : null,
    totals: {
      received: succeeded.reduce((sum, c) => sum + cashAmount(c), 0),
      count: succeeded.length,
      pending: contributions.filter((c) => c.status === 'pending').length,
    },
    // Abandoned checkouts are noise for the couple, so only real outcomes are listed.
    contributions: contributions.filter((c) => c.status !== 'abandoned').map(contributionDto),
  })
})

giftsRouter.get('/gifts/banks', async (_req, res) => {
  res.json({ banks: await listBanks() })
})

async function lookup(bankCode: string, accountNumber: string) {
  const bank = (await listBanks()).find((b) => b.code === bankCode)
  if (!bank) throw new HttpError(400, 'Choose a bank from the list', 'unknown_bank')
  const resolved = await resolveAccount(accountNumber, bankCode)
  return { bank, accountName: resolved.account_name }
}

// Step 1: show the couple whose account this is before anything is saved.
giftsRouter.post('/gifts/account/resolve', accountLookupLimiter, async (req, res) => {
  const { bankCode, accountNumber } = accountInput.parse(req.body)
  const { bank, accountName } = await lookup(bankCode, accountNumber)
  res.json({ bankName: bank.name, accountName })
})

// Step 2: save it. Creates (or updates) the couple's Paystack subaccount, then keeps only the
// bank, the resolved name and the last four digits.
giftsRouter.put('/gifts/account', accountLookupLimiter, async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const { bankCode, accountNumber } = accountInput.parse(req.body)
  const { bank, accountName } = await lookup(bankCode, accountNumber)

  const input = {
    business_name: `${[wedding.partnerOneName, wedding.partnerTwoName].filter(Boolean).join(' & ') || 'Wedding'} (Alárinà)`,
    bank_code: bankCode,
    account_number: accountNumber,
    description: `Wedding gifts for wedding ${String(wedding._id)}`,
  }
  const sub = wedding.payout?.subaccountCode
    ? await updateSubaccount(wedding.payout.subaccountCode, input)
    : await createSubaccount(input)

  wedding.payout = {
    bankCode,
    bankName: bank.name,
    accountName,
    accountLast4: accountNumber.slice(-4),
    subaccountCode: sub.subaccount_code,
    verifiedAt: new Date(),
  }
  await wedding.save()
  res.json({ payout: { bankName: bank.name, accountName, accountLast4: accountNumber.slice(-4) } })
})

const toggleInput = z.strictObject({ enabled: z.boolean() })

giftsRouter.patch('/gifts', async (req, res) => {
  const wedding = await ownWedding(req.auth!.user.coupleId)
  const { enabled } = toggleInput.parse(req.body)

  if (enabled) {
    if (!paystackConfigured()) {
      throw new HttpError(409, 'Cash gifts aren’t set up on this server yet', 'payments_not_configured')
    }
    if (!env.PAYSTACK_FEES_CONFIRMED) {
      throw new HttpError(409, 'Cash gifts can’t be switched on until payment fees are confirmed', 'fees_not_confirmed')
    }
    if (!wedding.payout) throw new HttpError(409, 'Add the account gifts should go to first', 'no_payout_account')
  }

  wedding.giftsEnabled = enabled
  await wedding.save()
  res.json({ enabled })
})
