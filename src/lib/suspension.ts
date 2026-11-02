import { Couple } from '../models/couple.js'
import { HttpError } from './httpError.js'

// Staff can suspend a couple from the admin app. While suspended, neither partner can sign in,
// any open sessions stop working, and their invitation and gift pages are offline to guests.
// Payments already made still settle, so no guest's money goes unrecorded.

export const isSuspended = async (coupleId: unknown) =>
  Boolean(await Couple.exists({ _id: coupleId, suspendedAt: { $type: 'date' } }))

export const accountSuspended = () =>
  new HttpError(403, 'This wedding space has been suspended. Contact Alárinà support for help.', 'account_suspended')
