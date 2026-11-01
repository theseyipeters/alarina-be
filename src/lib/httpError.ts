export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    if (code) this.code = code
    if (details !== undefined) this.details = details
  }
}

export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found')
