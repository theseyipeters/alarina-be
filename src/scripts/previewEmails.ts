// Writes every email, with sample data, to .email-previews/ so they can be opened in a browser.
// Run from be/: yarn email:preview
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  giftReceivedEmail,
  partnerInviteEmail,
  passwordChangedEmail,
  passwordResetEmail,
  rsvpLinkEmail,
  rsvpReceivedEmail,
  rsvpRejectedEmail,
  rsvpRestoredEmail,
  welcomeEmail,
  type RenderedEmail,
} from '../lib/emails.js'

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
  'password-reset': passwordResetEmail({ name: 'Adaeze Okafor', link: 'http://localhost:5173/reset-password/sample-token', minutes: 60 }),
  'password-changed': passwordChangedEmail({ name: 'Adaeze Okafor', changedAt: new Date() }),
  'partner-invite': partnerInviteEmail({ inviterName: 'Adaeze', link: 'http://localhost:5173/partner/accept/sample-token', expiresAt: inAMonth }),
  'rsvp-attending': rsvpLinkEmail({ ...rsvp, attending: true, isResend: false }),
  'rsvp-declined': rsvpLinkEmail({ ...rsvp, attending: false, isResend: false }),
  'rsvp-resend': rsvpLinkEmail({ ...rsvp, attending: true, isResend: true }),
  'rsvp-rejected': rsvpRejectedEmail({ wedding, guestName: 'Chidi Okeke' }),
  'rsvp-rejected-note': rsvpRejectedEmail({ wedding, guestName: 'Chidi Okeke', note: 'We kept the guest list very small this year. Thank you for understanding.' }),
  'rsvp-restored': rsvpRestoredEmail({ wedding, guestName: 'Chidi Okeke', link: 'http://localhost:5173/invite/sample' }),
  'couple-rsvp-attending': rsvpReceivedEmail({ name: 'Adaeze Okafor', wedding, guestName: 'Chidi Okeke', attending: true, comingSoFar: 42 }),
  'couple-rsvp-declined': rsvpReceivedEmail({ name: 'Adaeze Okafor', wedding, guestName: 'Chidi Okeke', attending: false, comingSoFar: 1 }),
  'couple-gift-cash': giftReceivedEmail({ name: 'Adaeze Okafor', wedding, guestName: 'Chidi Okeke', lines: [{ kind: 'cash', amount: 2500000 }], amount: 2500000 }),
  'couple-gift-basket': giftReceivedEmail({
    name: 'Tolu Adeyemi',
    wedding,
    guestName: 'Chidi Okeke',
    lines: [
      { kind: 'aso_ebi', amount: 4500000, itemName: 'Gold lace', unit: 'yard', unitPrice: 900000, quantity: 5 },
      { kind: 'wishlist', amount: 5000000, itemName: 'Stand mixer', unitPrice: 18000000 },
      { kind: 'cash', amount: 1000000 },
    ],
    amount: 10500000,
  }),
}

mkdirSync(out, { recursive: true })
for (const [name, email] of Object.entries(emails)) {
  writeFileSync(`${out}/${name}.html`, email.html)
  writeFileSync(`${out}/${name}.txt`, `Subject: ${email.subject}\n\n${email.text}\n`)
}
console.log(`Wrote ${Object.keys(emails).length} emails to ${out}/`)
