import { and, desc, eq } from "drizzle-orm"
import { redirect } from "react-router"

import * as schema from "../db/schema"
import type { AuthService } from "./auth.server"
import { type AppConfig, parseAppMetadata } from "./metadata"
import type { BaseServiceContext } from "./services"

function adminEmails(ctx: BaseServiceContext): string[] {
  return ctx
    .getAppEnv("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(ctx: BaseServiceContext, email?: string | null) {
  return !!email && adminEmails(ctx).includes(email.toLowerCase())
}

/** UI gate: require any signed-in session, else redirect to /login. */
export async function requireSession(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect("/login")
  return session
}

/** UI gate: require a signed-in admin. Non-admins go to their account, not a dead 403. */
export async function requireAdminSession(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
) {
  const session = await auth.api.getSession({ headers: request.headers })
  const admin = isAdminEmail(ctx, session?.user.email)
  ctx.logger.info("admin.gate", { hasSession: !!session, email: session?.user.email, admin })
  if (!session) throw redirect("/login")
  if (!admin) throw redirect("/account")
  return session
}

/**
 * better-auth and drizzle's mode:"json" columns don't always agree on
 * serialization (values can come back already-parsed, once-, or twice-encoded),
 * so unwrap defensively up to two JSON layers.
 */
function unwrap(v: unknown): unknown {
  let x = v
  for (let i = 0; i < 2 && typeof x === "string"; i++) {
    try {
      x = JSON.parse(x)
    } catch {
      break
    }
  }
  return x
}

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

/** Find an application by its app key (oauth_client.metadata.app). */
export async function getApplicationByApp(
  ctx: BaseServiceContext,
  app: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.app === app) ?? null
}

/**
 * Merge new product config into an app's metadata, preserving the immutable
 * `app` key. Validated config only (allow_signup + declared permission catalog).
 */
export async function updateApplicationMetadata(
  ctx: BaseServiceContext,
  clientId: string,
  config: AppConfig,
) {
  const [row] = await ctx.db
    .select({ metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId))
    .limit(1)
  const app = parseAppMetadata(unwrap(row?.metadata)).app
  await ctx.db
    .update(schema.oauthClient)
    .set({ metadata: { app, allow_signup: config.allow_signup, permissions: config.permissions } })
    .where(eq(schema.oauthClient.clientId, clientId))
}

/**
 * Replace an app's product-permission catalog, preserving the rest of its
 * metadata (immutable `app` key + allow_signup). Catalog entries are the
 * vocabulary members can be granted and what's emitted in the permissions claim.
 */
export async function updateApplicationPermissions(
  ctx: BaseServiceContext,
  clientId: string,
  permissions: string[],
) {
  const [row] = await ctx.db
    .select({ metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId))
    .limit(1)
  const meta = parseAppMetadata(unwrap(row?.metadata))
  await ctx.db
    .update(schema.oauthClient)
    .set({ metadata: { app: meta.app, allow_signup: meta.allow_signup, permissions } })
    .where(eq(schema.oauthClient.clientId, clientId))
}

/** Per-app free-form metadata stored for one user. */
export async function getUserAppMetadata(
  ctx: BaseServiceContext,
  app: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const [row] = await ctx.db
    .select({ data: schema.userAppMetadata.data })
    .from(schema.userAppMetadata)
    .where(
      and(
        eq(schema.userAppMetadata.applicationId, app),
        eq(schema.userAppMetadata.userId, userId),
      ),
    )
    .limit(1)
  return (unwrap(row?.data) as Record<string, unknown>) ?? {}
}

/** All per-user metadata rows for an app (for the member editor). */
export async function listUserMetadataForApp(ctx: BaseServiceContext, app: string) {
  const rows = await ctx.db
    .select({ userId: schema.userAppMetadata.userId, data: schema.userAppMetadata.data })
    .from(schema.userAppMetadata)
    .where(eq(schema.userAppMetadata.applicationId, app))
  return rows.map((r) => ({
    userId: r.userId,
    data: (unwrap(r.data) as Record<string, unknown>) ?? {},
  }))
}

export async function setUserAppMetadata(
  ctx: BaseServiceContext,
  app: string,
  userId: string,
  data: Record<string, unknown>,
) {
  await ctx.db
    .insert(schema.userAppMetadata)
    .values({ applicationId: app, userId, data })
    .onConflictDoUpdate({
      target: [schema.userAppMetadata.applicationId, schema.userAppMetadata.userId],
      set: { data, updatedAt: new Date() },
    })
}

/**
 * Registers an OAuth client and tags it with metadata.app (the application key
 * consumers' workspace claims are filtered by). Creation goes through better-auth
 * (which hashes the secret and requires the admin's session), then we set the
 * app tag with a direct update.
 */
export async function createApplication(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
  input: { name: string; redirectUris: string[]; app: string; creatorUserId: string },
) {
  const created = (await auth.api.createOAuthClient({
    headers: request.headers,
    body: { client_name: input.name, redirect_uris: input.redirectUris },
  })) as { client_id: string; client_secret: string }

  await ctx.db
    .update(schema.oauthClient)
    // mode:"json" column — pass the object; drizzle serializes it.
    .set({ metadata: { app: input.app } })
    .where(eq(schema.oauthClient.clientId, created.client_id))

  // Whoever creates the app is its first admin.
  await ctx.db
    .insert(schema.applicationMember)
    .values({ applicationId: input.app, userId: input.creatorUserId, role: "admin" })
    .onConflictDoNothing()

  return { clientId: created.client_id, clientSecret: created.client_secret }
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
 * Generates a new client secret and replaces the stored hash. The old secret
 * stops working immediately. The new plaintext is returned once.
 */
export async function rotateApplicationSecret(
  request: Request,
  auth: AuthService,
  clientId: string,
) {
  const res = (await auth.api.rotateClientSecret({
    headers: request.headers,
    body: { client_id: clientId },
  })) as { client_secret?: string; clientSecret?: string }
  return { clientId, clientSecret: res.client_secret ?? res.clientSecret ?? "" }
}

export async function updateApplicationRedirectUris(
  request: Request,
  auth: AuthService,
  clientId: string,
  redirectUris: string[],
) {
  await auth.api.updateOAuthClient({
    headers: request.headers,
    body: { client_id: clientId, update: { redirect_uris: redirectUris } },
  })
}

export async function deleteApplication(ctx: BaseServiceContext, clientId: string) {
  await ctx.db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId))
}

/** Workspaces belonging to one application. */
export async function listWorkspacesForApp(ctx: BaseServiceContext, app: string) {
  return ctx.db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      domain: schema.organization.domain,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.applicationId, app))
    .orderBy(desc(schema.organization.createdAt))
}

/** People with access to an app — derived from membership in its workspaces. */
export async function listPeopleForApp(ctx: BaseServiceContext, app: string) {
  return ctx.db
    .select({
      email: schema.user.email,
      name: schema.user.name,
      workspace: schema.organization.slug,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      and(
        eq(schema.member.organizationId, schema.organization.id),
        eq(schema.organization.applicationId, app),
      ),
    )
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
}

export async function listUsers(ctx: BaseServiceContext) {
  return ctx.db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
}

export async function listWorkspaces(ctx: BaseServiceContext) {
  return ctx.db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      applicationId: schema.organization.applicationId,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .orderBy(desc(schema.organization.createdAt))
}

export async function createWorkspace(
  request: Request,
  auth: AuthService,
  input: { name: string; slug: string; applicationId: string },
) {
  return auth.api.createOrganization({
    headers: request.headers,
    body: { name: input.name, slug: input.slug, applicationId: input.applicationId },
  })
}

/**
 * Session-less workspace creation for the management API. Better Auth's
 * createOrganization needs a user session (it makes the caller the owner); a
 * scoped API key has no user, so the row is inserted directly. Members are
 * added separately (via the member endpoints / invitations). Slug must be
 * unique across all apps (the organization table enforces it).
 */
export async function createWorkspaceForApp(
  ctx: BaseServiceContext,
  input: { app: string; name: string; slug: string; domain?: string | null },
): Promise<{ id: string; name: string; slug: string; domain: string | null } | { error: string }> {
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  const domain = input.domain?.trim().toLowerCase() || null
  if (!name || !slug) return { error: "Workspace name and slug are required." }

  const [clash] = await ctx.db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1)
  if (clash) return { error: `Slug "${slug}" is already taken.` }

  const id = crypto.randomUUID()
  await ctx.db.insert(schema.organization).values({
    id,
    name,
    slug,
    domain,
    applicationId: input.app,
    createdAt: new Date(),
  })
  return { id, name, slug, domain }
}
