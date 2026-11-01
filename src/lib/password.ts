import argon2 from 'argon2'

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id })

// Verified against when the email is unknown, so response time doesn't reveal which emails exist.
const dummyHash = await hashPassword('alarina-dummy-password')

export async function verifyPassword(hash: string | undefined, password: string) {
  const ok = await argon2.verify(hash ?? dummyHash, password).catch(() => false)
  return hash !== undefined && ok
}
