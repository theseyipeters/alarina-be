import { env } from '../config/env.js'

// Branded emails. One layout, built for what inboxes support: tables, inline styles, a PNG
// logo, system fonts (no web fonts, which would tell Google when an email is opened).
// Colours are the light theme from docs/style-guide.md. Emails stay light on purpose: inboxes
// that darken them do it unpredictably, so the logo sits on its own ivory and reads either way.

const C = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  panel: '#F4F4F0',
  text: '#18181B',
  muted: '#5C5C63',
  border: '#E6E5E0',
  accent: '#2E5A47',
}
const BODY_FONT = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const HEADING_FONT = `'Bricolage Grotesque', ${BODY_FONT}`

export type RenderedEmail = { subject: string; html: string; text: string }

type Email = {
  subject: string
  /** The grey preview line inboxes show after the subject. */
  preheader: string
  eyebrow: string
  /** Written without a full stop: the layout adds one in the accent colour, like the logo. */
  heading: string
  paragraphs: string[]
  /** A numbered list of what to do, in order. */
  steps?: { title: string; text: string }[]
  details?: { label: string; value: string }[]
  action: { label: string; url: string }
  note: string
  footer: string
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Lays out an email as HTML plus a plain-text version with the same words. */
function render(e: Email): RenderedEmail {
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:26px;color:${C.text};">${esc(text)}</p>`

  // Each step: an emerald numeral beside a title and one line. Rules between steps, none around them.
  const steps = e.steps?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">${e.steps
        .map(
          (s, i) => `
        <tr>
          <td width="36" valign="top" style="width:36px;padding:16px 0;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${HEADING_FONT};font-size:20px;line-height:24px;color:${C.accent};">${i + 1}</td>
          <td valign="top" style="padding:16px 0;${i ? `border-top:1px solid ${C.border};` : ''}">
            <p style="margin:0;font-family:${BODY_FONT};font-size:16px;line-height:24px;color:${C.text};">${esc(s.title)}</p>
            <p style="margin:2px 0 0;font-family:${BODY_FONT};font-size:14px;line-height:22px;color:${C.muted};">${esc(s.text)}</p>
          </td>
        </tr>`,
        )
        .join('')}
      </table>`
    : ''

  const details = e.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;background:${C.panel};border-radius:8px;">
        <tr><td style="padding:16px 20px;">${e.details
          .map(
            (d, i) =>
              `<p style="margin:${i ? '12px' : '0'} 0 0;font-family:${BODY_FONT};font-size:13px;line-height:18px;color:${C.muted};">${esc(d.label)}</p>
               <p style="margin:2px 0 0;font-family:${BODY_FONT};font-size:16px;line-height:24px;color:${C.text};">${esc(d.value)}</p>`,
          )
          .join('')}</td></tr>
      </table>`
    : ''

  // A "bulletproof" button: the link fills a coloured cell, so it works where CSS padding on links doesn't.
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td bgcolor="${C.text}" style="background:${C.text};border-radius:8px;">
        <a href="${esc(e.action.url)}" style="display:inline-block;padding:14px 28px;font-family:${BODY_FONT};font-size:16px;line-height:20px;color:${C.bg};text-decoration:none;border-radius:8px;">${esc(e.action.label)}</a>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.muted};">
      Or open this link: <a href="${esc(e.action.url)}" style="color:${C.accent};word-break:break-all;">${esc(e.action.url)}</a>
    </p>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(e.subject)}</title>
<style>
  @media (max-width: 600px) {
    .card { padding: 28px 24px !important; }
    .heading { font-size: 24px !important; line-height: 30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 24px;">
        <a href="${esc(env.CLIENT_ORIGIN)}" style="text-decoration:none;">
          <img src="${esc(env.CLIENT_ORIGIN)}/brand/alarina-logo-email.png" width="152" height="28" alt="Alárinà"
            style="display:block;width:152px;height:28px;border:0;font-family:Georgia,serif;font-size:22px;line-height:28px;color:${C.text};">
        </a>
      </td></tr>
      <tr><td class="card" bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:40px;">
        <p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${esc(e.eyebrow)}</p>
        <h1 class="heading" style="margin:0 0 20px;font-family:${HEADING_FONT};font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.02em;color:${C.text};">${esc(e.heading)}<span style="color:${C.accent};">.</span></h1>
        ${e.paragraphs.map(p).join('\n        ')}
        ${steps}
        ${details}
        ${button}
        <p style="margin:32px 0 0;padding:24px 0 0;border-top:1px solid ${C.border};font-family:${BODY_FONT};font-size:14px;line-height:22px;color:${C.muted};">${esc(e.note)}</p>
      </td></tr>
      <tr><td style="padding:24px 4px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.muted};">
        <p style="margin:0;">${esc(e.footer)}</p>
        <p style="margin:8px 0 0;">Alárinà<span style="color:${C.accent};">.</span> Wedding invitations and RSVPs</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const text = [
    `${e.heading}.`,
    ...e.paragraphs,
    ...(e.steps?.length ? [e.steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.text}`).join('\n\n')] : []),
    ...(e.details?.length ? [e.details.map((d) => `${d.label}: ${d.value}`).join('\n')] : []),
    `${e.action.label}: ${e.action.url}`,
    e.note,
    `--\n${e.footer}\nAlárinà. Wedding invitations and RSVPs`,
  ].join('\n\n')

  return { subject: e.subject, html, text }
}

const lagosDate = (d: Date) =>
  new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)

/** "2026-12-12" → "Saturday, 12 December 2026" (noon Lagos time, so the day never shifts). */
const calendarDay = (ymd: string) => lagosDate(new Date(`${ymd}T12:00:00+01:00`))

/** "14:00" → "2:00 pm" */
const clock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(Date.UTC(2000, 0, 1, h, m)))
    .toLowerCase()
}

/** Sent on sign-up: what Alárinà does, and the steps from here to the first RSVP. */
export function welcomeEmail({ name }: { name: string }) {
  const firstName = name.trim().split(/\s+/)[0]
  return render({
    subject: `Welcome to Alárinà, ${firstName}`,
    preheader: 'Your wedding space is ready. Here’s how to get from here to your first RSVP.',
    eyebrow: 'Welcome',
    heading: `Welcome, ${firstName}`,
    paragraphs: [
      'Your wedding space is ready. Here’s how to get from here to your first RSVP. Everything saves as you go, so you can stop and pick up again any time.',
    ],
    steps: [
      { title: 'Invite your partner', text: 'Plan together, each with your own sign-in.' },
      { title: 'Set up your wedding', text: 'Your names, the date, the venue and any events around the day.' },
      { title: 'Design your invitation', text: 'Choose a layout, colours and fonts, or open Studio on a laptop for every option. Change them whenever you like.' },
      { title: 'Publish and share', text: 'Send one link to everyone, or your personal links to see whose guests are whose.' },
      { title: 'Watch the replies come in', text: 'See who’s coming at a glance. Turn on cash gifts if you’d like them.' },
    ],
    action: { label: 'Set up your wedding', url: `${env.CLIENT_ORIGIN}/app` },
    note: 'Didn’t create an account on Alárinà? Someone may have typed your address by mistake. You can ignore this email.',
    footer: 'You’re getting this because this address was used to create an account on Alárinà.',
  })
}

/** The "forgot password" link. */
export function passwordResetEmail({ name, link, minutes }: { name: string; link: string; minutes: number }) {
  const firstName = name.trim().split(/\s+/)[0]
  const valid = minutes === 60 ? 'an hour' : `${minutes} minutes`
  return render({
    subject: 'Reset your Alárinà password',
    preheader: `Choose a new password. This link works once, for ${valid}.`,
    eyebrow: 'Password reset',
    heading: `Reset your password, ${firstName}`,
    paragraphs: ['Someone asked to reset the password for your Alárinà account. If that was you, choose a new one below.'],
    action: { label: 'Choose a new password', url: link },
    note: `This link works once and expires in ${valid}. If you didn’t ask for it, you can ignore this email: your password stays the same.`,
    footer: 'You’re getting this because a password reset was requested for this address on Alárinà.',
  })
}

/** Sent after a password changes, so someone would notice if it wasn't them. */
export function passwordChangedEmail({ name, changedAt }: { name: string; changedAt: Date }) {
  const firstName = name.trim().split(/\s+/)[0]
  const when = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(changedAt)
    .replace(/\b(AM|PM)\b/, (m) => m.toLowerCase())
  return render({
    subject: 'Your Alárinà password was changed',
    preheader: 'If this wasn’t you, reset your password now.',
    eyebrow: 'Security',
    heading: 'Your password was changed',
    paragraphs: [
      `Hi ${firstName}, the password for your Alárinà account was changed on ${when} (Lagos time). Every other device has been signed out.`,
      'If this was you, there’s nothing else to do.',
    ],
    action: { label: 'Reset my password', url: `${env.CLIENT_ORIGIN}/forgot-password` },
    note: 'If you didn’t change it, reset it straight away with the button above. Anyone using the old password has already been signed out.',
    footer: 'You’re getting this because the password changed on your Alárinà account.',
  })
}

export function partnerInviteEmail({ inviterName, link, expiresAt }: { inviterName: string; link: string; expiresAt: Date }) {
  return render({
    subject: `${inviterName} invited you to plan your wedding on Alárinà`,
    preheader: `Accept to plan your wedding together. The link works once, until ${lagosDate(expiresAt)}.`,
    eyebrow: 'Partner invite',
    heading: `Plan your wedding with ${inviterName}`,
    paragraphs: [
      `${inviterName} is setting up your wedding on Alárinà: the invitation, the guest list and everyone’s replies.`,
      'Accept to join them. You’ll have your own sign-in and work on the same wedding.',
    ],
    action: { label: 'Accept invite', url: link },
    note: `This link works once and expires on ${lagosDate(expiresAt)}. Weren’t expecting this? You can ignore this email.`,
    footer: `You’re getting this because ${inviterName} entered your email address on Alárinà.`,
  })
}

type WeddingInfo = {
  partnerOneName?: string | null
  partnerTwoName?: string | null
  date?: string | null
  startTime?: string | null
  venueName?: string | null
  venueAddress?: string | null
}

const coupleNames =(w: WeddingInfo) => [w.partnerOneName, w.partnerTwoName].filter(Boolean).join(' & ')

/**
 * The guest's private link to view or change their RSVP. Sent after a new reply, or again
 * (with a fresh link) when someone tries to reply a second time with the same address.
 */
export function rsvpLinkEmail({
  wedding,
  guestName,
  attending,
  link,
  expiresAt,
  isResend,
}: {
  wedding: WeddingInfo
  guestName: string
  attending: boolean
  link: string
  expiresAt: Date
  isResend: boolean
}) {
  const names = coupleNames(wedding) || 'the couple'
  const firstName = guestName.trim().split(/\s+/)[0]
  const keepPrivate = `Keep this link to yourself: anyone with it can change your reply. It works until ${lagosDate(expiresAt)}.`
  const action = { label: 'View or change your reply', url: link }
  const footer = `Sent by Alárinà for ${names}’s wedding, because this address was used to reply to their invitation.`

  if (isResend) {
    return render({
      subject: `Your RSVP link for ${names}’s wedding`,
      preheader: 'A fresh private link to view or change your reply.',
      eyebrow: 'Your RSVP',
      heading: `Here’s a new link, ${firstName}`,
      paragraphs: [
        `Someone tried to reply to ${names}’s invitation with this email address. You’ve already replied, so we’ve sent you a fresh private link instead.`,
        'If that wasn’t you, nothing has changed. Your reply stays as it was.',
      ],
      action,
      note: `Your earlier link no longer works. ${keepPrivate}`,
      footer,
    })
  }

  const when = [wedding.date && calendarDay(wedding.date), wedding.startTime && clock(wedding.startTime)].filter(Boolean).join(' · ')
  const where = [wedding.venueName, wedding.venueAddress].filter(Boolean).join(', ')

  return render({
    subject: `Thanks for your reply to ${names}`,
    preheader: attending ? 'You’re on the list. Keep this email to change your reply later.' : 'Your reply is saved. Keep this email to change it later.',
    eyebrow: 'Your RSVP',
    heading: `Thanks for replying, ${firstName}`,
    paragraphs: [
      attending ? `Your reply is saved: you’re coming to ${names}’s wedding.` : `Your reply is saved: you can’t make it to ${names}’s wedding.`,
      'If your plans change, you can view or change your reply with your private link below.',
    ],
    // The details are only useful to guests who are coming.
    details: attending
      ? [
          ...(when ? [{ label: 'When', value: when }] : []),
          ...(where ? [{ label: 'Where', value: where }] : []),
        ]
      : undefined,
    action,
    note: keepPrivate,
    footer,
  })
}

/** A new staff member's link to set their password for the admin app (or a fresh one). */
export function staffSetupEmail({ name, invitedBy, link, expiresAt }: { name: string; invitedBy: string; link: string; expiresAt: Date }) {
  const firstName = name.trim().split(/\s+/)[0]
  return render({
    subject: 'Set up your Alárinà staff account',
    preheader: `Choose a password for the admin app. The link works once, until ${lagosDate(expiresAt)}.`,
    eyebrow: 'Staff account',
    heading: `Welcome to the team, ${firstName}`,
    paragraphs: [
      `${invitedBy} added you as Alárinà staff. The admin app lets you look after couples, payments and support requests.`,
      'Choose a password to finish setting up your account.',
    ],
    action: { label: 'Choose a password', url: link },
    note: `This link works once and expires on ${lagosDate(expiresAt)}. Weren’t expecting this? You can ignore this email.`,
    footer: `You’re getting this because ${invitedBy} entered your email address in the Alárinà admin app.`,
  })
}
