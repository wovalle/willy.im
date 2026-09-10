import { and, eq, gt, isNotNull } from "drizzle-orm"

import * as schema from "../db/schema"
import { avatarUrl } from "./avatar"
import { parseAppMetadata, type AppMetadata } from "./metadata"
import { adminScopesFor, isDeclared, type AppCatalog } from "./scopes.server"
import type { BaseServiceContext } from "./services"

/**
 * The custom OIDC claims the IdP attaches for one application. Kept apart from
 * auth.server.ts (which builds the whole Better Auth service) because these are
 * plain database reads: the id_token hook, the /userinfo hook, and the tests all
 * want them without standing up an auth service.
 */

export const WORKSPACES_CLAIM = "https://willy.im/workspaces"
export const PERMISSIONS_CLAIM = "https://willy.im/permissions"

/** The catalog as stored, in the shape the scope checks read. */
export function catalogFromMetadata(meta: AppMetadata): AppCatalog {
  return { permissions: meta.permissions, resourceTypes: meta.resource_types }
}

/**
 * The caller's resolved *product* permissions for one app, read at token-mint
 * (never from the client). Admins resolve to the app's full declared catalog —
 * every flat permission plus `<type>:*` per resource type, since instances are
 * the app's to enumerate, not ours. Members get their granted product
 * permissions filtered to what the catalog still DECLARES: a flat entry that
 * is still listed, or `<type>:<id>` under a type that is still declared. The
 * instance itself is not re-checked here — that would make every token mint
 * depend on the app being up; existence is verified when the grant is written,
 * and a grant to an instance that has since gone simply matches nothing on
 * the app's side. App-scoped via metadata.app.
 */
export async function productPermissionsFor(
  db: BaseServiceContext["db"],
  userId: string,
  app: string | undefined,
  catalog: AppCatalog,
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
  if (member.role === "admin") return adminScopesFor(catalog)
  return (member.productPermissions ?? []).filter((p) => isDeclared(p, catalog))
}

/**
 * The `picture` claim, which we guarantee is always present.
 *
 * Better Auth emits one only for users who uploaded an image — i.e. almost
 * nobody here, since sign-in is an email OTP or a passkey. That left every
 * consumer app writing the same initials-fallback, so the IdP answers it once:
 * a blobatar rendered by this issuer, seeded on the user id (see ./avatar).
 *
 * A claim rather than a write to `user.image`, on purpose. The column keeps
 * meaning "a picture this user chose", and changing how we generate the rest
 * stays a deploy instead of a migration.
 */
export function pictureClaimFor(
  user: { id: string; image?: string | null },
  origin: string,
): { picture: string } {
  return { picture: user.image || avatarUrl(origin, user.id) }
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
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(and(eq(schema.member.userId, userId), eq(schema.organization.applicationId, app)))
}

/** The application key a token is for — carried in the access token so a resource server can say which app's grants it holds. */
export const APP_CLAIM = "https://willy.im/app"

/**
 * Which application owns `resource` — the app whose metadata lists that URI.
 * Null when nobody does, which the token endpoint has already refused by then
 * (validAudiences), so this is a lookup, not a gate. Exact match, because an
 * audience is compared exactly on the other side.
 */
export async function appForResource(
  db: BaseServiceContext["db"],
  resource: string,
): Promise<{ app: string; catalog: AppCatalog } | null> {
  const rows = await db.select({ metadata: schema.oauthClient.metadata }).from(schema.oauthClient)
  for (const row of rows) {
    const meta = parseAppMetadata(row.metadata)
    if (meta.app && meta.resources.includes(resource)) {
      return { app: meta.app, catalog: catalogFromMetadata(meta) }
    }
  }
  return null
}

/** Every resource URI any application declares — the token endpoint's valid audiences. */
export async function allResources(db: BaseServiceContext["db"]): Promise<string[]> {
  const rows = await db.select({ metadata: schema.oauthClient.metadata }).from(schema.oauthClient)
  return [...new Set(rows.flatMap((row) => parseAppMetadata(row.metadata).resources))]
}

/**
 * The claims on an ACCESS token. An access token is what a resource server
 * (an MCP server, an API) reads, so unlike the id_token it carries the
 * permissions for the app that owns the requested `resource`, not for the
 * OAuth client that asked. That distinction is the whole point: Claude is one
 * client registered once, and the same access token flow hands it bender's
 * grants when it asks for bender's resource and another app's when it asks
 * for theirs. Without a resource we fall back to the client's own app, which
 * is the pre-MCP behaviour for first-party clients.
 */
export async function accessTokenClaimsFor(
  db: BaseServiceContext["db"],
  userId: string,
  resource: string | string[] | undefined,
  metadata: unknown,
): Promise<Record<string, unknown>> {
  const requested = Array.isArray(resource) ? resource[0] : resource
  const owner = requested ? await appForResource(db, requested) : null
  const meta = parseAppMetadata(metadata)
  const app = owner?.app ?? meta.app ?? undefined
  const catalog = owner?.catalog ?? catalogFromMetadata(meta)
  const [permissions, act] = await Promise.all([
    productPermissionsFor(db, userId, app, catalog),
    actClaimFor(db, userId),
  ])
  return {
    ...(app ? { [APP_CLAIM]: app } : {}),
    ...(permissions.length ? { [PERMISSIONS_CLAIM]: permissions } : {}),
    ...(act ? { act } : {}),
  }
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
    productPermissionsFor(db, userId, app, catalogFromMetadata(meta)),
    actClaimFor(db, userId),
  ])
  return {
    ...(workspaces.length ? { [WORKSPACES_CLAIM]: workspaces } : {}),
    ...(permissions.length ? { [PERMISSIONS_CLAIM]: permissions } : {}),
    ...(act ? { act } : {}),
  }
}
