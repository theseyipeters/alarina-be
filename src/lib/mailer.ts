import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

type Mail = { to: string; subject: string; text: string }

/** Sends via Resend when configured. Returns whether the email was handed off; never throws. */
export async function sendMail({ to, subject, text }: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    logger.info({ to, subject }, 'Email not configured, skipping send')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
    })
    if (!res.ok) {
      logger.error({ status: res.status }, 'Email provider rejected the message')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'Email send failed')
    return false
  }
}
