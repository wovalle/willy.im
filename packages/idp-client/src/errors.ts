/** The one error type this package throws. Its own module so validation and
 * the client can both raise it without importing each other. */
export class IdpError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "IdpError"
    this.status = status
    this.body = body
  }
}
