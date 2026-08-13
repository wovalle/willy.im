/**
 * The claim set the IdP hands back, with the `https://willy.im/*` namespace
 * unwrapped. Namespaced URI claims are an OIDC requirement, not something app
 * code should ever have to type — `claims.permissions`, not
 * `claims["https://willy.im/permissions"]`.
 */

export const PERMISSIONS_CLAIM = "https://willy.im/permissions"
export const WORKSPACES_CLAIM = "https://willy.im/workspaces"

/** A tenant inside THIS app. `domain` is set for multi-domain apps, else null. */
export type Workspace = {
  id: string
  slug: string
  name: string
  domain: string | null
  role: string
}

/**
 * The RFC 8693 `act` claim: present while an IdP admin is impersonating the
 * user. Audit-only — tag your logs with it, never branch authorization on it.
 */
export type Actor = { sub: string; email?: string }

export type Claims = {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  image: string | null
  /** Product permissions granted in this app. Unwrapped from the namespace. */
  permissions: string[]
  /** Workspaces the user belongs to in this app. Unwrapped from the namespace. */
  workspaces: Workspace[]
  actor: Actor | null
}

/** Wire claims -> `Claims`. Tolerant: a missing claim is an empty value, not a throw. */
export function normalizeClaims(payload: Record<string, unknown>): Claims {
  return {
    sub: str(payload.sub) ?? "",
    email: str(payload.email) ?? "",
    emailVerified: payload.email_verified === true,
    name: str(payload.name),
    image: str(payload.picture) ?? str(payload.image),
    permissions: Array.isArray(payload[PERMISSIONS_CLAIM])
      ? (payload[PERMISSIONS_CLAIM] as unknown[]).map(String)
      : [],
    workspaces: Array.isArray(payload[WORKSPACES_CLAIM])
      ? (payload[WORKSPACES_CLAIM] as Record<string, unknown>[]).map((w) => ({
          id: String(w.id ?? ""),
          slug: String(w.slug ?? ""),
          name: String(w.name ?? ""),
          domain: str(w.domain),
          role: String(w.role ?? "member"),
        }))
      : [],
    actor: actorOf(payload.act),
  }
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

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function actorOf(value: unknown): Actor | null {
  if (!value || typeof value !== "object") return null
  const act = value as Record<string, unknown>
  const sub = str(act.sub)
  if (!sub) return null
  const email = str(act.email)
  return email ? { sub, email } : { sub }
}
