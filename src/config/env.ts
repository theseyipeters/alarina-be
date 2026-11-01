import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  CLIENT_ORIGIN: z.url(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Optional: without these, partner invites are not emailed (the link is still returned)
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:')
  console.error(z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
