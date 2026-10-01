import { invalidFields } from "./method.js"
import type { CallArgs, PublicMethod, Result } from "./types.js"

/** Throws an error `Response`: React Router renders it, the API returns it as is. */
export function fail(status: 400 | 401 | 403 | 404 | 409, message: string): never {
  throw Response.json({ error: message }, { status })
}

/**
 * Calls a method with untrusted input (a form, a JSON body). Invalid input comes
 * back as `{ ok: false, errors }`; any other failure is rethrown.
 */
export async function safe<I, O, R>(m: PublicMethod<I, O, R>, raw: unknown): Promise<Result<R>> {
  const input = raw instanceof FormData ? Object.fromEntries(raw) : raw
  try {
    return { ok: true, value: await m(...([input] as CallArgs<I>)) }
  } catch (e) {
    const errors = invalidFields(e)
    if (errors) return { ok: false, errors }
    throw e
  }
}
