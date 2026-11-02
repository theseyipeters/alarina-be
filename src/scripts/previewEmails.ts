// Writes every email, with sample data, to .email-previews/ so they can be opened in a browser.
// Run from be/: yarn email:preview
import { mkdirSync, writeFileSync } from 'node:fs'
import { partnerInviteEmail, rsvpLinkEmail, welcomeEmail, type RenderedEmail } from '../lib/emails.js'

const out = '.email-previews'
const inAMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const wedding = {
  partnerOneName: 'Adaeze',
  partnerTwoName: 'Tolu',
  date: '2026-12-12',
  startTime: '14:00',
  venueName: 'Eko Hotel & Suites',
  venueAddress: 'Adetokunbo Ademola Street, Victoria Island, Lagos',
}
const rsvp = { wedding, guestName: 'Chidi Okeke', link: 'http://localhost:5173/rsvp/sample-token', expiresAt: new Date('2026-12-12T23:59:59+01:00') }

const emails: Record<string, RenderedEmail> = {
  welcome: welcomeEmail({ name: 'Adaeze Okafor' }),
  'partner-invite': partnerInviteEmail({ inviterName: 'Adaeze', link: 'http://localhost:5173/partner/accept/sample-token', expiresAt: inAMonth }),
  'rsvp-attending': rsvpLinkEmail({ ...rsvp, attending: true, isResend: false }),
  'rsvp-declined': rsvpLinkEmail({ ...rsvp, attending: false, isResend: false }),
  'rsvp-resend': rsvpLinkEmail({ ...rsvp, attending: true, isResend: true }),
}

mkdirSync(out, { recursive: true })
for (const [name, email] of Object.entries(emails)) {
  writeFileSync(`${out}/${name}.html`, email.html)
  writeFileSync(`${out}/${name}.txt`, `Subject: ${email.subject}\n\n${email.text}\n`)
}
console.log(`Wrote ${Object.keys(emails).length} emails to ${out}/`)
