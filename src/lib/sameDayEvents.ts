/**
 * Before the ceremony and reception had their own steps, couples added their church service or
 * reception as an "other event" on the wedding day. Which part of the day an event's name says it
 * is, or null when the name doesn't tell (an after-party, say), so it stays an event.
 */
export function sameDayRole(name: string): 'ceremony' | 'reception' | null {
  const n = name.toLowerCase()
  if (/church|chapel|cathedral|matrimony|service|solemni[sz]|mosque|nikk?ah|registry|court/.test(n)) return 'ceremony'
  if (/reception|walimah/.test(n)) return 'reception'
  return null
}
