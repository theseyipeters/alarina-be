import { createHash, randomBytes } from 'node:crypto'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** A fresh URL-safe secret and the hash that is safe to store. */
export function newToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}
