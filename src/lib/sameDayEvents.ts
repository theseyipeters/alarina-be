import type { CEREMONY_TYPES } from '../models/wedding.js'

type CeremonyType = (typeof CEREMONY_TYPES)[number]

/**
 * Before the ceremony and reception had their own steps, couples added their church service or
 * reception as an "other event" on the wedding day. Which part of the day an event's name says it
 * is, or null when the name doesn't tell (an after-party, say), so it stays an event.
 */
export function sameDayRole(name: string): { as: 'ceremony'; type: CeremonyType } | { as: 'reception' } | null {
  const n = name.toLowerCase()
  if (/church|chapel|cathedral|matrimony|service|solemni[sz]/.test(n)) return { as: 'ceremony', type: 'church' }
  if (/mosque|nikk?ah/.test(n)) return { as: 'ceremony', type: 'mosque' }
  if (/registry|court/.test(n)) return { as: 'ceremony', type: 'registry' }
  if (/reception|walimah/.test(n)) return { as: 'reception' }
  return null
}
