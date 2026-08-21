/**
 * One place where a wire payload becomes a typed value.
 *
 * Everything the IdP hands us — discovery, tokens, userinfo, management API
 * responses — goes through here. A malformed payload raises an `IdpError` that
 * names the offending field, rather than a `TypeError` three frames later on a
 * property that was never there.
 *
 * `502` is the status: the failure is upstream, not in the caller's request.
 */

import type { z } from "zod"

import { IdpError } from "./errors.js"

/** `["workspaces", 0, "id"]` -> `"workspaces.0.id"`. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.length ? path.map(String).join(".") : "(root)"
}

export function parseWire<T extends z.ZodType>(schema: T, value: unknown, what: string): z.output<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const detail = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
    .join("; ")
  throw new IdpError(`${what} returned a malformed payload (${detail})`, 502, {
    issues: result.error.issues,
    received: value,
  })
}
