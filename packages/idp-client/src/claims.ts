/**
 * Claim types and the permission check over them. The shapes themselves live
 * in `./wire.ts` as zod schemas — this module re-exports them so app code has
 * one obvious import, and owns `grants`, which is logic rather than parsing.
 */

import { ClaimsSchema, type Claims } from "./wire.js"
import { parseWire } from "./validate.js"

export {
  ActorSchema,
  ClaimsSchema,
  PERMISSIONS_CLAIM,
  WORKSPACES_CLAIM,
  WorkspaceSchema,
  type Actor,
  type Claims,
  type Workspace,
} from "./wire.js"

/**
 * Wire claims -> `Claims`. Tolerant by design: a missing or malformed optional
 * claim degrades to an empty value. Only `sub` is required — without it there
 * is no identity to seat a session on.
 */
export function normalizeClaims(payload: unknown): Claims {
  return parseWire(ClaimsSchema, payload, "userinfo")
}

/**
 * Does this permission set grant `permission`? Exact match, plus prefix
 * wildcards — a grant of `invoices:*` covers `invoices:read`, and `*` covers
 * everything. The IdP hands out concrete permissions today; the wildcard exists
 * so an app-level catalog can group them without the SDK needing to know how.
 */
export function grants(permissions: readonly string[], permission: string): boolean {
  if (permissions.includes(permission) || permissions.includes("*")) return true
  for (const granted of permissions) {
    if (!granted.endsWith(":*")) continue
    if (permission.startsWith(granted.slice(0, -1))) return true
  }
  return false
}
