import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { HttpError } from './httpError.js'

export const paystackConfigured = () => Boolean(env.PAYSTACK_SECRET_KEY)

const unavailable = () =>
  new HttpError(502, 'Payments are unavailable right now. Try again in a few minutes.', 'payments_unavailable')

type Envelope<T> = { status: boolean; message: string; data: T }

/** Calls Paystack's API. Network or API failures become a 502 with a friendly message. */
async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new HttpError(503, 'Cash gifts aren’t set up on this server', 'payments_not_configured')
  }
  let res: Response
  try {
    res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    logger.error({ err, path }, 'Paystack request failed')
    throw unavailable()
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || !json?.status) {
    logger.warn({ status: res.status, path, message: json?.message }, 'Paystack rejected a request')
    // Account lookups fail with 4xx when the details are wrong; say so instead of "unavailable".
    if (res.status >= 400 && res.status < 500 && path.startsWith('/bank/resolve')) {
      throw new HttpError(422, 'That account number doesn’t match this bank', 'account_not_found')
    }
    throw unavailable()
  }
  return json.data
}

export type Bank = { name: string; code: string }

let bankCache: { at: number; banks: Bank[] } | null = null

/** Nigerian banks, cached for a day. */
export async function listBanks() {
  if (bankCache && Date.now() - bankCache.at < 24 * 60 * 60 * 1000) return bankCache.banks
  const data = await call<{ name: string; code: string; active?: boolean }[]>('GET', '/bank?country=nigeria&perPage=200')
  const banks = data.filter((b) => b.active !== false).map(({ name, code }) => ({ name, code }))
  bankCache = { at: Date.now(), banks }
  return banks
}

export const resolveAccount = (accountNumber: string, bankCode: string) =>
  call<{ account_name: string; account_number: string }>(
    'GET',
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  )

type SubaccountInput = { business_name: string; bank_code: string; account_number: string; description: string }

// The couple's share is 100%; Alárinà takes nothing (percentage_charge 0).
export const createSubaccount = (input: SubaccountInput) =>
  call<{ subaccount_code: string }>('POST', '/subaccount', { ...input, percentage_charge: 0 })

export const updateSubaccount = (code: string, input: SubaccountInput) =>
  call<{ subaccount_code: string }>('PUT', `/subaccount/${encodeURIComponent(code)}`, { ...input, percentage_charge: 0 })

export const initializeTransaction = (input: {
  email: string
  amount: number
  reference: string
  subaccount: string
  callback_url: string
  metadata: Record<string, unknown>
}) =>
  // bearer 'subaccount': Paystack's fee comes out of the couple's share, which the guest has
  // already covered by paying the grossed-up amount.
  call<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
    ...input,
    currency: 'NGN',
    bearer: 'subaccount',
  })

export type VerifiedTransaction = { status: string; amount: number; currency: string; reference: string; paid_at: string | null }

export const verifyTransaction = (reference: string) =>
  call<VerifiedTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`)
