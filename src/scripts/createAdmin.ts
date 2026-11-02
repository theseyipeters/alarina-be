import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { env } from '../config/env.js'
import { connectDb, disconnectDb } from '../db/connect.js'
import { SETUP_TTL_HOURS, setupLink } from '../lib/adminSessions.js'
import { newToken } from '../lib/tokens.js'
import { AdminUser } from '../models/adminUser.js'

// Adds a staff member for the admin app, or gives an existing one a fresh setup link, and prints
// the link. Use it for the first account; after that, staff add each other from the admin app.
//
//   yarn admin:create --email ada@alarina.ng --name "Ada Obi"

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

if (!env.ADMIN_ORIGIN) {
  console.error('Set ADMIN_ORIGIN in be/.env first (e.g. http://localhost:5174).')
  process.exit(1)
}

const rl = createInterface({ input: stdin, output: stdout })
const email = (arg('email') ?? (await rl.question('Email: '))).trim().toLowerCase()
let name = arg('name')?.trim()
rl.close()

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('That doesn’t look like an email address.')
  process.exit(1)
}

await connectDb()
const existing = await AdminUser.findOne({ email })
if (!existing && !name) {
  const ask = createInterface({ input: stdin, output: stdout })
  name = (await ask.question('Name: ')).trim()
  ask.close()
}
if (!existing && !name) {
  console.error('A name is needed for a new staff member.')
  await disconnectDb()
  process.exit(1)
}

const { token, tokenHash } = newToken()
const setupExpiresAt = new Date(Date.now() + SETUP_TTL_HOURS * 60 * 60 * 1000)
const admin = existing ?? new AdminUser({ email, name })
admin.setupTokenHash = tokenHash
admin.setupExpiresAt = setupExpiresAt
admin.disabledAt = undefined
await admin.save()
await disconnectDb()

console.log(`\n${existing ? 'Fresh setup link for' : 'Added'} ${admin.name} <${admin.email}>.`)
console.log(`Open this link to choose a password (works once, for ${SETUP_TTL_HOURS} hours):\n\n  ${setupLink(token)}\n`)
