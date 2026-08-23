import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { recordAudit } from "./audit.server"
import type { AuthService } from "./auth.server"
import { assertCan, type Caller } from "./caller.server"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from "./client-secret.server"
import { type AppConfig, parseAppMetadata, unwrapJson as unwrap } from "./metadata"
import type { BaseServiceContext } from "./services"
import { firstInvalidRedirectUri } from "./validate"

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

/** Find an application by its app key (oauth_client.metadata.app). */
export async function getApplicationByApp(
  ctx: BaseServiceContext,
  app: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.app === app) ?? null
}

/**
 * The app key an OAuth client is tagged with, or "" when it has none. Empty
 * string is deliberately unmatchable by any member grant, so only a superadmin
 * gets past a gate on an untagged client.
 */
async function appKeyOf(ctx: BaseServiceContext, clientId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId))
    .limit(1)
  return parseAppMetadata(unwrap(row?.metadata)).app ?? ""
}

/**
 * Merge new product config into an app's metadata, preserving the immutable
 * `app` key. Validated config only (allow_signup + declared permission catalog).
 *
 * Requires `app:update`. The check lives here rather than in the route so the
 * console and the management API cannot authorize this differently.
 */
export async function updateApplicationMetadata(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
  config: AppConfig,
) {
  const app = await appKeyOf(ctx, clientId)
  await assertCan(caller, app, "app:update")
  await ctx.db
    .update(schema.oauthClient)
    .set({ metadata: { app: app || null, allow_signup: config.allow_signup, permissions: config.permissions, resources: config.resources } })
    .where(eq(schema.oauthClient.clientId, clientId))
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "update",
    applicationId: app,
    rowId: clientId,
    after: config,
  })
}

/**
 * Replace an app's product-permission catalog, preserving the rest of its
 * metadata (immutable `app` key + allow_signup). Catalog entries are the
 * vocabulary members can be granted and what's emitted in the permissions claim.
 */
export async function updateApplicationPermissions(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
  permissions: string[],
) {
  const [row] = await ctx.db
    .select({ metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId))
    .limit(1)
  const meta = parseAppMetadata(unwrap(row?.metadata))
  await assertCan(caller, meta.app ?? "", "app:update")
  const next = [...new Set(permissions.map((p) => p.trim()).filter(Boolean))]
  await ctx.db
    .update(schema.oauthClient)
    .set({ metadata: { app: meta.app, allow_signup: meta.allow_signup, permissions: next, resources: meta.resources } })
    .where(eq(schema.oauthClient.clientId, clientId))
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "update",
    applicationId: meta.app ?? "",
    rowId: clientId,
    after: { permissions: next },
  })
  return next
}

export type CreateApplicationInput = {
  name: string
  app: string
  redirectUris: string[]
  /**
   * Who becomes the app's first IdP admin. Defaults to the calling user. Pass
   * `null` explicitly for an app with no members at all — a legitimate outcome
   * when an agent registers an app with the static admin token: there is no
   * human to enrol, so the app starts superadmin-managed and members are added
   * later through the member endpoints.
   */
  firstAdminUserId?: string | null
}

/** App keys are used in URLs and claim filters, so keep them boring. */
const APP_KEY_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Registers an OAuth client (confidential web client) and tags it with
 * `metadata.app` — the application key consumers' workspace claims are filtered
 * by. Superadmin only.
 *
 * The row is inserted directly rather than through the plugin's
 * `/oauth2/create-client`, which is behind `sessionMiddleware` and would tie
 * application registration to a browser. The column values below replicate what
 * that endpoint writes for a confidential web client; the secret is hashed with
 * the very hasher the plugin is configured with (see client-secret.server.ts),
 * so the two paths produce interchangeable rows.
 *
 * The plaintext secret is returned exactly once and is not recoverable after.
 */
export async function createApplication(
  ctx: BaseServiceContext,
  caller: Caller,
  input: CreateApplicationInput,
): Promise<
  | { clientId: string; clientSecret: string; app: string }
  | { error: "app_taken" }
  | { error: "invalid_app" | "invalid_redirect_uri"; detail?: string }
> {
  // Creating an application is an IdP-level act: there is no app to scope it to
  // yet, so no per-app permission could ever authorize it.
  if (caller.kind !== "superadmin") throw Response.json({ error: "forbidden" }, { status: 403 })

  const app = input.app.trim().toLowerCase()
  if (!APP_KEY_RE.test(app)) return { error: "invalid_app", detail: input.app }
  const name = input.name.trim()
  if (!name) return { error: "invalid_app", detail: "name is required" }
  if (input.redirectUris.length === 0)
    return { error: "invalid_redirect_uri", detail: "at least one redirect URI is required" }
  const invalid = firstInvalidRedirectUri(input.redirectUris)
  if (invalid) return { error: "invalid_redirect_uri", detail: invalid }

  // The app key is the join key for members, workspaces, keys and claims, so it
  // has to be unique. It lives inside a JSON column, hence the scan.
  const existing = await listApplications(ctx)
  if (existing.some((a) => a.app === app)) return { error: "app_taken" }

  const clientId = generateClientId()
  const clientSecret = generateClientSecret()
  const now = new Date()

  await ctx.db.insert(schema.oauthClient).values({
    id: crypto.randomUUID(),
    clientId,
    clientSecret: await hashClientSecret(clientSecret),
    name,
    redirectUris: input.redirectUris,
    // Confidential web client — the plugin's documented defaults for a client
    // registered with a secret. `requirePKCE: true` matches its runtime default
    // (`client.requirePKCE ?? true`), written out so the row is self-describing.
    tokenEndpointAuthMethod: "client_secret_basic",
    // The SDK refreshes with grant_type=refresh_token; declare it so a plugin
    // version that enforces grants per client doesn't break new apps only.
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    type: "web",
    public: false,
    disabled: false,
    skipConsent: false,
    requirePKCE: true,
    scopes: null,
    userId: caller.userId,
    metadata: { app },
    createdAt: now,
    updatedAt: now,
  })

  const firstAdminUserId =
    input.firstAdminUserId === undefined ? caller.userId : input.firstAdminUserId
  if (firstAdminUserId) {
    await ctx.db
      .insert(schema.applicationMember)
      .values({ applicationId: app, userId: firstAdminUserId, role: "admin" })
      .onConflictDoNothing()
  }

  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "create",
    applicationId: app,
    rowId: clientId,
    after: { name, app, redirectUris: input.redirectUris, firstAdminUserId: firstAdminUserId ?? null },
  })

  return { clientId, clientSecret, app }
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

/**
 * Generates a new client secret and replaces the stored hash. The old secret
 * stops working immediately. The new plaintext is returned once. Requires
 * `app:update`.
 */
export async function rotateApplicationSecret(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const app = await appKeyOf(ctx, clientId)
  await assertCan(caller, app, "app:update")
  const clientSecret = generateClientSecret()
  await ctx.db
    .update(schema.oauthClient)
    .set({ clientSecret: await hashClientSecret(clientSecret), updatedAt: new Date() })
    .where(eq(schema.oauthClient.clientId, clientId))
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "update",
    applicationId: app,
    rowId: clientId,
    after: { rotatedSecret: true },
  })
  return { clientId, clientSecret }
}

/** Replaces an app's registered redirect URIs. Requires `app:update`. */
export async function updateApplicationRedirectUris(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
  redirectUris: string[],
) {
  const app = await appKeyOf(ctx, clientId)
  await assertCan(caller, app, "app:update")
  await ctx.db
    .update(schema.oauthClient)
    .set({ redirectUris, updatedAt: new Date() })
    .where(eq(schema.oauthClient.clientId, clientId))
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "update",
    applicationId: app,
    rowId: clientId,
    after: { redirectUris },
  })
}

/**
 * Partial update of an application's registration: display name, redirect URIs
 * and the open-signup flag. Omitted fields are left alone. One permission check
 * and one audit entry for the whole patch. Requires `app:update`.
 */
export async function updateApplication(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
  patch: { name?: string; redirectUris?: string[]; allowSignup?: boolean; resources?: string[] },
): Promise<
  | ApplicationSummary
  | { error: "invalid_redirect_uri" | "invalid_resource"; detail: string }
  | null
> {
  const current = await getApplication(ctx, clientId)
  if (!current) return null
  await assertCan(caller, current.app ?? "", "app:update")

  if (patch.redirectUris) {
    const invalid = firstInvalidRedirectUri(patch.redirectUris)
    if (invalid) return { error: "invalid_redirect_uri", detail: invalid }
  }
  // A resource is an audience a token will be minted FOR, so it has to be an
  // absolute https URI with no fragment (RFC 8707 §2) — anything looser and a
  // token could be minted for a string no resource server will ever match.
  const resources = patch.resources?.map((r) => r.trim()).filter(Boolean)
  if (resources) {
    for (const r of resources) {
      let parsed: URL | null = null
      try { parsed = new URL(r) } catch { /* handled below */ }
      if (!parsed || parsed.protocol !== "https:" || parsed.hash) {
        return { error: "invalid_resource", detail: r }
      }
    }
  }
  const metadataChanged = patch.allowSignup !== undefined || resources !== undefined

  await ctx.db
    .update(schema.oauthClient)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.redirectUris !== undefined ? { redirectUris: patch.redirectUris } : {}),
      ...(metadataChanged
        ? {
            metadata: {
              app: current.app,
              allow_signup: patch.allowSignup ?? current.allowSignup,
              permissions: current.permissions,
              resources: resources ?? current.resources,
            },
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.oauthClient.clientId, clientId))

  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "update",
    applicationId: current.app ?? "",
    rowId: clientId,
    after: patch,
  })

  return (await getApplication(ctx, clientId))!
}

/** Deregisters an application. Requires `app:delete`. */
export async function deleteApplication(
  ctx: BaseServiceContext,
  caller: Caller,
  clientId: string,
) {
  const app = await appKeyOf(ctx, clientId)
  await assertCan(caller, app, "app:delete")
  await ctx.db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId))
  // Audited after the fact and against the app key, so the trail survives the
  // client row it describes.
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "oauth_client",
    operation: "delete",
    applicationId: app,
    rowId: clientId,
  })
}

/** Workspaces belonging to one application. */
export async function listWorkspacesForApp(ctx: BaseServiceContext, app: string) {
  return ctx.db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
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

/** One user by id, or null. Backs the user detail page's header. */
export async function getUser(ctx: BaseServiceContext, userId: string) {
  const [row] = await ctx.db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  return row ?? null
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

/**
 * Session-less workspace creation — the only workspace-creation path. Better
 * Auth's createOrganization needs a user session (it makes the caller the
 * owner); a scoped API key has no user, so the row is inserted directly.
 * Members are added separately (via the member endpoints / invitations). Slug
 * must be unique across all apps (the organization table enforces it).
 *
 * Requires `workspace:create` on the target app.
 */
export async function createWorkspaceForApp(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; name: string; slug: string },
): Promise<{ id: string; name: string; slug: string } | { error: string }> {
  await assertCan(caller, input.app, "workspace:create")
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
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
    applicationId: input.app,
    createdAt: new Date(),
  })
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "organization",
    operation: "create",
    applicationId: input.app,
    rowId: id,
    after: { name, slug },
  })
  return { id, name, slug }
}
