import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { recordAudit } from "./audit.server"
import type { AuthService } from "./auth.server"
import { avatarUrl } from "./avatar"
import { assertCan, type Caller } from "./caller.server"
import { parseAppMetadata, type ResourceTypeDecl, unwrapJson as unwrap } from "./metadata"
import type { AppCatalog } from "./scopes.server"
import type { BaseServiceContext } from "./services"

function coerceUriList(v: unknown): string[] {
  const x = unwrap(v)
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []
}

export type ApplicationSummary = {
  clientId: string
  name: string | null
  app: string | null
  allowSignup: boolean
  permissions: string[]
  /** Declared resource types — permission families over instances the app holds. */
  resourceTypes: ResourceTypeDecl[]
  /** Protected resource URIs (e.g. the app's MCP server) — valid `resource` audiences. */
  resources: string[]
  redirectUris: string[]
  disabled: boolean
  createdAt: Date
}

export async function listApplications(ctx: BaseServiceContext): Promise<ApplicationSummary[]> {
  const rows = await ctx.db
    .select({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
      metadata: schema.oauthClient.metadata,
      redirectUris: schema.oauthClient.redirectUris,
      disabled: schema.oauthClient.disabled,
      createdAt: schema.oauthClient.createdAt,
    })
    .from(schema.oauthClient)
    .orderBy(desc(schema.oauthClient.createdAt))

  return rows.map((r) => {
    const meta = parseAppMetadata(unwrap(r.metadata))
    return {
      clientId: r.clientId,
      name: r.name,
      app: meta.app,
      allowSignup: meta.allow_signup,
      permissions: meta.permissions,
      resourceTypes: meta.resource_types,
      resources: meta.resources,
      redirectUris: coerceUriList(r.redirectUris),
      disabled: !!r.disabled,
      createdAt: r.createdAt ?? new Date(0),
    }
  })
}

export async function getApplication(
  ctx: BaseServiceContext,
  clientId: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.clientId === clientId) ?? null
}

/** The app key an OAuth client is tagged with, or null for an unknown or untagged client. */
export async function appKeyOf(ctx: BaseServiceContext, clientId: string): Promise<string | null> {
  return (await getApplication(ctx, clientId))?.app ?? null
}

/** Find an application by its app key (oauth_client.metadata.app). */
export async function getApplicationByApp(
  ctx: BaseServiceContext,
  app: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.app === app) ?? null
}

/** The two halves of an app's product catalog, as the scope checks read them. */
export function catalogOf(application: ApplicationSummary | null | undefined): AppCatalog {
  return {
    permissions: application?.permissions ?? [],
    resourceTypes: application?.resourceTypes ?? [],
  }
}

/** App admins/members (IdP-level), with their user details. */
export async function listAppMembers(ctx: BaseServiceContext, app: string) {
  return ctx.db
    .select({
      userId: schema.applicationMember.userId,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.applicationMember.role,
      permissions: schema.applicationMember.permissions,
      productPermissions: schema.applicationMember.productPermissions,
    })
    .from(schema.applicationMember)
    .innerJoin(schema.user, eq(schema.applicationMember.userId, schema.user.id))
    .where(eq(schema.applicationMember.applicationId, app))
}

/**
 * Starts an impersonation session as one of `app`'s members, returning the
 * `set-cookie` headers Better Auth minted so the caller can hand them back to
 * the browser.
 *
 * Requires `user:impersonate` *and* IdP superadmin: the Better Auth admin role
 * is superadmin-only (see auth.server.ts), so a mere permission grant must not
 * be enough. The target is scoped to this app's members, which is what makes
 * the act app-bound and auditable.
 */
export async function impersonateAppMember(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; userId: string; auth: AuthService; headers: Headers },
): Promise<{ setCookies: string[] } | { error: string }> {
  await assertCan(caller, input.app, "user:impersonate")
  if (caller.kind !== "superadmin") return { error: "Only superadmins can impersonate." }

  const members = await listAppMembers(ctx, input.app)
  const target = members.find((m) => m.userId === input.userId)
  if (!target) return { error: "That user isn't a member of this app." }

  const res = await input.auth.api.impersonateUser({
    body: { userId: input.userId },
    headers: input.headers,
    asResponse: true,
  })
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "user",
    operation: "impersonate",
    applicationId: input.app,
    rowId: input.userId,
    after: { email: target.email },
  })
  return { setCookies: res.headers.getSetCookie() }
}

export async function listUsers(ctx: BaseServiceContext) {
  return ctx.db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      // Null for anyone who never uploaded one, which is most people. Callers
      // fall back to the avatar route — `resolveAvatars` below does it for the
      // API, and console markup does it inline.
      image: schema.user.image,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
}

/** One user by id, or null. Backs the user detail page's header. */
export async function getUser(ctx: BaseServiceContext, userId: string) {
  const [row] = await ctx.db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      image: schema.user.image,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  return row ?? null
}

/**
 * Fills in `image` the way the `picture` claim does, so an API consumer gets an
 * avatar it can render without knowing this IdP has an avatar route at all.
 * Absolute, because the reader is on another origin.
 */
export function resolveAvatars<T extends { id: string; image: string | null }>(
  users: T[],
  origin: string,
): (T & { image: string })[] {
  return users.map((u) => ({ ...u, image: u.image || avatarUrl(origin, u.id) }))
}
