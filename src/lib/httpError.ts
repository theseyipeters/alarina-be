export class HttpError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    if (code) this.code = code
  }
}

export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found')
