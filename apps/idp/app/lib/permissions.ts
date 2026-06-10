/**
 * IdP management permissions — what a principal may do *to an application within
 * the IdP* (distinct from an app's own product permissions, which the app
 * declares and enforces itself).
 *
 * Kept inline for now; mirrors the shape of @willyim/rbac so it can be swapped
 * to that package once it's a workspace dependency.
 */
export const APP_PERMISSIONS = [
  "app:read",
  "app:update",
  "app:delete",
  "workspace:read",
  "workspace:create",
  "workspace:delete",
  "member:read",
  "member:invite",
  "member:manage",
  "apikey:read",
  "apikey:create",
  "apikey:revoke",
  "user:impersonate",
] as const

export type AppPermission = (typeof APP_PERMISSIONS)[number]

export type AppRole = "admin" | "member"

/** Resolve the effective permission set for a role + explicit grants. admin = all. */
export function resolvePermissions(role: AppRole, granted: string[] = []): AppPermission[] {
  if (role === "admin") return [...APP_PERMISSIONS]
  return granted.filter((p): p is AppPermission =>
    (APP_PERMISSIONS as readonly string[]).includes(p),
  )
}
