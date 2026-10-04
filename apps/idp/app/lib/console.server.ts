/**
 * A method's refusal as a console form shows it: `{ error, field }`. kit's
 * invalid input (400) reads as its first field error; `fail()`'s 404/409/422/502
 * as its message. A 401/403 or anything that isn't a `Response` is thrown: the
 * page can't fix those by editing the form.
 */
export async function attempt<T>(
  fn: () => Promise<T>,
  field?: string,
): Promise<T | { error: string; field?: string }> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof Response) || ![400, 404, 409, 422, 502].includes(e.status)) throw e
    const body = (await e.json().catch(() => ({}))) as {
      error?: string
      fields?: Record<string, string[] | undefined>
    }
    const [name, errors] = Object.entries(body.fields ?? {})[0] ?? []
    const error = errors?.[0] ? `${name === "_" ? "" : `${name}: `}${errors[0]}` : body.error
    return { error: error ?? "Something went wrong.", ...(field ? { field } : {}) }
  }
}

/** Did `attempt` come back with a refusal? */
export const refused = (value: unknown): value is { error: string; field?: string } =>
  typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
