import { z } from 'zod'

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Invalid date')
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time')

/** Today's date in Nigeria, as YYYY-MM-DD (en-CA formats dates that way). */
export const todayInLagos = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())
