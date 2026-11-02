import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5001),
  MONGODB_URI: z.string().min(1),
  CLIENT_ORIGIN: z.url(),
  // Origin of the staff admin app (admin/). Without it the admin API is switched off.
  ADMIN_ORIGIN: z.url().optional(),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Optional: without these, partner invites and RSVP links are not emailed (the link is still shown)
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  // Paystack. Without a secret key, cash gifts are switched off everywhere.
  // Secret keys start with sk_test_ or sk_live_; catching a typo here beats a vague "Invalid key" later.
  PAYSTACK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_[A-Za-z0-9]+$/, 'should look like sk_test_… or sk_live_… (check for stray characters)')
    .optional(),
  PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
  // Set to true only after checking that the fee maths in lib/fees.ts matches this Paystack
  // account's pricing. Until then couples can't switch gifts on.
  PAYSTACK_FEES_CONFIRMED: z.stringbool().default(false),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:')
  console.error(z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
