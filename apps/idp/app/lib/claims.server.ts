import { and, eq, gt, isNotNull } from "drizzle-orm"

import * as schema from "../db/schema"
import { parseAppMetadata } from "./metadata"
import type { BaseServiceContext } from "./services"

/**
 * The custom OIDC claims the IdP attaches for one application. Kept apart from
 * auth.server.ts (which builds the whole Better Auth service) because these are
 * plain database reads: the id_token hook, the /userinfo hook, and the tests all
 * want them without standing up an auth service.
 */

export const WORKSPACES_CLAIM = "https://willy.im/workspaces"
export const PERMISSIONS_CLAIM = "https://willy.im/permissions"

/**
 * The caller's resolved *product* permissions for one app, read at token-mint
 * (never from the client). Admins resolve to the app's full declared catalog;
 * members to their granted product permissions (intersected with the catalog,
 * in case the catalog shrank since the grant). App-scoped via metadata.app.
 */
export async function productPermissionsFor(
  db: BaseServiceContext["db"],
  userId: string,
  app: string | undefined,
  catalog: string[],
): Promise<string[]> {
  if (!app) return []
  const [member] = await db
    .select({
      role: schema.applicationMember.role,
      productPermissions: schema.applicationMember.productPermissions,
    })
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, app),
        eq(schema.applicationMember.userId, userId),
      ),
    )
    .limit(1)
  if (!member) return []
  if (member.role === "admin") return catalog
  const allowed = new Set(catalog)
  return (member.productPermissions ?? []).filter((p) => allowed.has(p))
}

/**
 * RFC 8693 `act` (actor) claim. If this user has an active impersonated session,
 * the token is being minted on behalf of an admin acting as them — surface the
 * admin so downstream apps can AUDIT it (they aren't expected to act on it). The
 * claim hook has no session context, so we look up the live impersonated session
 * by user; best-effort, audit-only.
 */
export async function actClaimFor(
  db: BaseServiceContext["db"],
  userId: string,
): Promise<{ sub: string; email?: string } | null> {
  const [s] = await db
    .select({ impersonatedBy: schema.session.impersonatedBy })
    .from(schema.session)
    .where(
      and(
        eq(schema.session.userId, userId),
        isNotNull(schema.session.impersonatedBy),
        gt(schema.session.expiresAt, new Date()),
      ),
    )
    .limit(1)
  const adminId = s?.impersonatedBy
  if (!adminId) return null
  const [admin] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, adminId))
    .limit(1)
  return { sub: adminId, ...(admin?.email ? { email: admin.email } : {}) }
}

/**
 * The workspaces (organizations) the user belongs to *within one application*,
 * with their role. Scoped by organization.applicationId so a consumer only ever
 * sees its own tenants. Consumers map role -> permissions via packages/rbac.
 */
export async function workspaceClaimsFor(
  db: BaseServiceContext["db"],
  userId: string,
  app?: string,
) {
  if (!app) return []
  return db
    .select({
      id: schema.organization.id,
      slug: schema.organization.slug,
      name: schema.organization.name,
      domain: schema.organization.domain,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(and(eq(schema.member.userId, userId), eq(schema.organization.applicationId, app)))
}

/**
 * The custom claim set we attach for one app: workspaces + product permissions
 * + the `act` impersonation marker. Shared by the id_token and userinfo hooks
 * so downstream apps see the same picture wherever they look.
 */
export async function customClaimsFor(
  db: BaseServiceContext["db"],
  userId: string,
  metadata: unknown,
): Promise<Record<string, unknown>> {
  const meta = parseAppMetadata(metadata)
  const app = meta.app ?? undefined
  const [workspaces, permissions, act] = await Promise.all([
    workspaceClaimsFor(db, userId, app),
    productPermissionsFor(db, userId, app, meta.permissions),
    actClaimFor(db, userId),
  ])
  return {
    ...(workspaces.length ? { [WORKSPACES_CLAIM]: workspaces } : {}),
    ...(permissions.length ? { [PERMISSIONS_CLAIM]: permissions } : {}),
    ...(act ? { act } : {}),
  }
}
