import { connectDb, disconnectDb } from '../db/connect.js'
import { sameDayRole } from '../lib/sameDayEvents.js'
import { Wedding } from '../models/wedding.js'

// Moves a church service (or reception) that a couple added as an "other event" on their wedding
// day into the ceremony or reception, where the invitation now shows them together. Only clear
// cases: one such event, with a venue, and no reception venue entered yet. Everything else is
// listed and left alone.
//
//   yarn db:move-same-day-events            lists what it would change
//   yarn db:move-same-day-events --apply    makes the changes
//   add --wedding <id> to look at one wedding only
const apply = process.argv.includes('--apply')
const only = process.argv[process.argv.indexOf('--wedding') + 1]
const filter = process.argv.includes('--wedding') && only ? { _id: only } : {}

await connectDb()
let moved = 0
for await (const w of Wedding.find({ ...filter, date: { $exists: true }, 'events.0': { $exists: true } })) {
  const sameDay = w.events.filter((e) => e.date === w.date)
  if (!sameDay.length) continue

  const matched = sameDay.flatMap((e) => {
    const role = sameDayRole(e.name)
    return role ? [{ event: e, role }] : []
  })
  const id = String(w._id)
  if (matched.length !== 1 || (w.receptionSeparate && w.receptionVenueName) || !matched[0]!.event.venueName) {
    console.log(`skip ${id}: same-day events [${sameDay.map((e) => e.name).join(', ')}] need the couple to sort them out`)
    continue
  }

  const { event, role } = matched[0]!
  if (role === 'ceremony') {
    // The event is the ceremony; the venue the couple had as the main one becomes the reception.
    console.log(`${apply ? 'move' : 'would move'} ${id}: "${event.name}" → ceremony; main venue → reception`)
    w.set({
      receptionSeparate: true,
      receptionVenueName: w.venueName,
      receptionVenueAddress: w.venueAddress,
      receptionTime: w.startTime,
      receptionName: w.ceremonyName,
      ceremonyName: event.name,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      startTime: event.startTime ?? w.startTime,
    })
  } else {
    console.log(`${apply ? 'move' : 'would move'} ${id}: "${event.name}" → reception`)
    w.set({
      receptionSeparate: true,
      receptionVenueName: event.venueName,
      receptionVenueAddress: event.venueAddress,
      receptionTime: event.startTime,
      receptionName: event.name,
    })
  }
  w.events.pull({ id: event.id })
  if (apply) await w.save()
  moved++
}
console.log(apply ? `${moved} moved` : `${moved} would move. Run again with --apply to make the changes.`)
await disconnectDb()
