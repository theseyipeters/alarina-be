import mongoose from 'mongoose'

/** Runs `fn` in a transaction (retried on transient errors). Throwing inside rolls everything back. */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession()
  try {
    return await session.withTransaction(() => fn(session))
  } finally {
    await session.endSession()
  }
}

export const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === 11000
