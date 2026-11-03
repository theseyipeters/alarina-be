import type { HydratedDocument } from 'mongoose'
import type { WeddingDoc } from '../models/wedding.js'
import { todayInLagos } from './dates.js'

export type Wedding = HydratedDocument<WeddingDoc>

/** The answers that make up the invitation itself. Also what guests see on the public page. */
export const invitationContent = (w: Wedding) => ({
  template: w.template,
  palette: w.palette,
  look: lookDto(w.look),
  partnerOneName: w.partnerOneName ?? null,
  partnerTwoName: w.partnerTwoName ?? null,
  partnerOneRole: w.partnerOneRole ?? null,
  partnerTwoRole: w.partnerTwoRole ?? null,
  partnerOneFamily: w.partnerOneFamily ?? null,
  partnerTwoFamily: w.partnerTwoFamily ?? null,
  partnerOneFather: w.partnerOneFather ?? null,
  partnerOneMother: w.partnerOneMother ?? null,
  partnerTwoFather: w.partnerTwoFather ?? null,
  partnerTwoMother: w.partnerTwoMother ?? null,
  lateParents: [...w.lateParents],
  date: w.date ?? null,
  startTime: w.startTime ?? null,
  venueName: w.venueName ?? null,
  venueAddress: w.venueAddress ?? null,
  dressNote: w.dressNote ?? null,
  message: w.message ?? null,
  rsvpDeadline: w.rsvpDeadline ?? null,
  events: w.events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date ?? null,
    startTime: e.startTime ?? null,
    venueName: e.venueName ?? null,
    venueAddress: e.venueAddress ?? null,
  })),
})

/** Studio choices, with null for anything that follows the template's default. */
function lookDto(look: WeddingDoc['look']) {
  const colors = look?.colors
  return {
    namesFont: look?.namesFont ?? null,
    headingFont: look?.headingFont ?? null,
    bodyFont: look?.bodyFont ?? null,
    nameScale: look?.nameScale ?? null,
    nameCase: look?.nameCase ?? null,
    joiner: look?.joiner ?? null,
    texture: look?.texture ?? null,
    corners: look?.corners ?? null,
    frame: look?.frame ?? null,
    colors: colors ? { background: colors.background, card: colors.card, text: colors.text, accent: colors.accent } : null,
  }
}

/** Whether guests can still send a new RSVP: not after the deadline, and not after the wedding day. */
export function rsvpStatus(w: Wedding): { open: true } | { open: false; reason: 'deadline' | 'past' } {
  const today = todayInLagos()
  if (w.date && today > w.date) return { open: false, reason: 'past' }
  if (w.rsvpDeadline && today > w.rsvpDeadline) return { open: false, reason: 'deadline' }
  return { open: true }
}
