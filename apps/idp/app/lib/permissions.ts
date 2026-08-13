import { definePermissions } from "@willyim/rbac"

/**
 * IdP management permissions — what a principal may do *to an application within
 * the IdP* (distinct from an app's own product permissions, which the app
 * declares and enforces itself).
 *
 * Defined with @willyim/rbac: permissions are the primitive, roles are named
 * permission bags. `admin` holds the whole catalog; `member` holds nothing by
 * role — a member's permissions are the explicit grants stored on their
 * application_member row (intersected with the catalog below).
 */
const PERMISSIONS = [
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
  // End-user API keys for the app's own API (minted/validated via the IdP).
  "userkey:read",
  "userkey:create",
  "userkey:revoke",
  "userkey:validate",
  "audit:read",
  "user:impersonate",
] as const

export const appRbac = definePermissions({
  permissions: PERMISSIONS,
  roles: {
    admin: PERMISSIONS,
    member: [],
  },
})

export const APP_PERMISSIONS = appRbac.permissions

export type AppPermission = (typeof APP_PERMISSIONS)[number]

export type AppRole = keyof (typeof appRbac)["roles"] & string

/** Is `value` a permission this IdP knows about? */
export function isAppPermission(value: string): value is AppPermission {
  return (APP_PERMISSIONS as readonly string[]).includes(value)
}

/** Resolve the effective permission set for a role + explicit grants. admin = all. */
export function resolvePermissions(role: AppRole, granted: string[] = []): AppPermission[] {
  // Effective = the role's bag ∪ the explicit grants (filtered to the catalog, in
  // case it shrank since the grant). admin's bag is everything, so the union is
  // the whole catalog; member's bag is empty, so it's just their grants.
  const checker = appRbac.createChecker(role)
  return [...new Set([...checker.granted, ...granted.filter(isAppPermission)])]
}
