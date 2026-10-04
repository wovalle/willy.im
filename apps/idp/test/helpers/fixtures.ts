import { eq } from "drizzle-orm"

import * as schema from "../../app/db/schema"
import {
  createAdminKey,
  createApiKey,
  generateToken,
  hashToken,
} from "../../app/lib/api-keys.server"
import type { AuthService } from "../../app/lib/auth.server"
import { app } from "../../app/kit.server"
import {
  callerFromPrincipal,
  principalFrom,
  resolveCaller,
  type Caller,
  type IdpPrincipal,
} from "../../app/lib/caller.server"
import type { ResourceTypeDecl } from "../../app/lib/metadata"
import type { AppPermission } from "../../app/lib/permissions"
import {
  ResourceListError,
  type ResourceInstance,
  type ResourceLister,
} from "../../app/lib/resources.server"
import type { BaseServiceContext } from "../../app/lib/services"

/**
 * Row builders for the tables the service layer reads. Deliberately thin — they
 * insert exactly what production inserts, so tests exercise the real shapes.
 */

let counter = 0
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

export async function createUser(
  ctx: BaseServiceContext,
  input: { email: string; name?: string; id?: string },
) {
  const id = input.id ?? `user_${uniq()}`
  await ctx.db.insert(schema.user).values({
    id,
    name: input.name ?? input.email,
    email: input.email.trim().toLowerCase(),
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { id, email: input.email.trim().toLowerCase() }
}

/**
 * Registers an OAuth client tagged with `metadata.app` — the application key
 * everything else (members, workspaces, keys, claims) is scoped by.
 */
export async function createApplication(
  ctx: BaseServiceContext,
  input: {
    app: string
    name?: string
    allowSignup?: boolean
    /** The app's declared product-permission catalog. */
    permissions?: string[]
    /** Resource types the app declares — the families `<type>:<id>` grants compose under. */
    resourceTypes?: ResourceTypeDecl[]
    redirectUris?: string[]
  },
) {
  const clientId = `client_${input.app}_${uniq()}`
  await ctx.db.insert(schema.oauthClient).values({
    id: `oc_${uniq()}`,
    clientId,
    name: input.name ?? input.app,
    redirectUris: input.redirectUris ?? [`https://${input.app}.test/callback`],
    metadata: {
      app: input.app,
      allow_signup: input.allowSignup ?? false,
      permissions: input.permissions ?? [],
      resource_types: input.resourceTypes ?? [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { clientId, app: input.app }
}

export async function createMember(
  ctx: BaseServiceContext,
  input: {
    app: string
    userId: string
    role: "admin" | "member"
    permissions?: string[]
    productPermissions?: string[]
  },
) {
  await ctx.db.insert(schema.applicationMember).values({
    applicationId: input.app,
    userId: input.userId,
    role: input.role,
    permissions: input.permissions ?? [],
    productPermissions: input.productPermissions ?? [],
  })
}

/** A workspace (organization) belonging to one application. */
export async function createWorkspace(
  ctx: BaseServiceContext,
  input: { app: string; slug: string; name?: string },
) {
  const id = `org_${uniq()}`
  await ctx.db.insert(schema.organization).values({
    id,
    name: input.name ?? input.slug,
    slug: input.slug,
    applicationId: input.app,
    createdAt: new Date(),
  })
  return { id, slug: input.slug }
}

export async function addWorkspaceMember(
  ctx: BaseServiceContext,
  input: { organizationId: string; userId: string; role?: string },
) {
  await ctx.db.insert(schema.member).values({
    id: `mem_${uniq()}`,
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role ?? "member",
    createdAt: new Date(),
  })
}

/** A live session row — what `actClaimFor` reads to detect impersonation. */
export async function createSession(
  ctx: BaseServiceContext,
  input: { userId: string; impersonatedBy?: string | null; expiresAt?: Date },
) {
  const id = `sess_${uniq()}`
  await ctx.db.insert(schema.session).values({
    id,
    token: `tok_${uniq()}`,
    userId: input.userId,
    impersonatedBy: input.impersonatedBy ?? null,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { id }
}

/** A Request carrying a bearer token, for the management-API gates. */
export function bearerRequest(token: string, url = "https://idp.willy.im/api/v1/apps") {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } })
}

/** The resolver only reads `api.getSession`; a bearer caller never has one. */
const sessionlessAuth = {
  api: { getSession: async () => null },
} as unknown as AuthService

/**
 * The break-glass admin key, written straight into `api_key` the way real
 * recovery does: an unscoped row (`application_id` NULL) whose `key_hash` is
 * the SHA-256 of a token we generated. Everything a test needs to act as a
 * superadmin comes back — the plaintext bearer, a Request carrying it, and the
 * Caller the *real* resolver builds from it, so no test hand-rolls a superadmin
 * object that production could never produce.
 */
export async function bootstrapAdminKey(
  ctx: BaseServiceContext,
  input: { name?: string; expiresAt?: Date | null } = {},
): Promise<{
  id: string
  name: string
  token: string
  request: Request
  caller: Caller
  principal: IdpPrincipal
}> {
  const token = generateToken()
  const id = `adminkey_${uniq()}`
  const name = input.name ?? "Bootstrap key"
  await ctx.db.insert(schema.apiKey).values({
    id,
    applicationId: null,
    name,
    prefix: token.slice(0, 12),
    keyHash: await hashToken(token),
    permissions: [],
    expiresAt: input.expiresAt ?? null,
  })
  const request = bearerRequest(token)
  const caller = await resolveCaller(request, ctx, sessionlessAuth)
  const principal = await principalFrom(request, ctx, sessionlessAuth)
  if (!caller || !principal)
    throw new Error("bootstrapAdminKey: the resolver rejected the key it was handed")
  return { id, name, token, request, caller, principal }
}

/**
 * A signed-in human caller with an explicit permission set on one app: one
 * membership, built into a Caller the way the resolver builds one.
 */
export function fakeUserCaller(input: {
  userId: string
  email?: string
  app: string
  permissions: AppPermission[]
}): Caller {
  return callerFromPrincipal(
    {
      id: `user:${input.userId}`,
      grants: [],
      memberships: [{ tenantId: input.app, grants: input.permissions }],
    },
    {
      via: "session",
      userId: input.userId,
      email: input.email ?? `${input.userId}@test`,
      keyId: null,
      applicationId: null,
      actor: { userId: input.userId, label: `user:${input.userId}` },
    },
  )
}

/**
 * A signed-in human as the real resolver sees them: their grants come from the
 * `application_member` rows in the database, not from the test. `impersonatedBy`
 * makes it an impersonation session, as Better Auth's admin plugin marks one.
 */
export async function signedInCaller(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
  input: { impersonatedBy?: string } = {},
): Promise<Caller> {
  const auth = {
    api: {
      getSession: async () => ({
        user,
        session: { impersonatedBy: input.impersonatedBy ?? null },
      }),
    },
  } as unknown as AuthService
  const caller = await resolveCaller(new Request("https://idp.willy.im/"), ctx, auth)
  if (!caller) throw new Error("signedInCaller: the resolver rejected the session")
  return caller
}

/** Mints a scoped key as `caller`, unwrapping the error union. */
export async function mintApiKey(
  ctx: BaseServiceContext,
  input: { app: string; name?: string; permissions?: string[]; expiresAt?: Date | null },
  caller: Caller,
) {
  const res = await createApiKey(ctx, caller, {
    app: input.app,
    name: input.name ?? "CI runner",
    permissions: input.permissions ?? ["member:read", "member:invite"],
    expiresAt: input.expiresAt ?? null,
  })
  if ("error" in res) throw new Error(`mintApiKey: ${res.error} ${res.detail.join(",")}`)
  return res
}

/** Mints an IdP-level admin key (unscoped ⇒ superadmin) through the service. */
export async function mintAdminKey(
  ctx: BaseServiceContext,
  input: { name?: string; expiresAt?: Date | null },
  caller: Caller,
) {
  return createAdminKey(ctx, caller, {
    name: input.name ?? "Agent alpha",
    expiresAt: input.expiresAt ?? null,
  })
}

/**
 * A `ResourceLister` that answers from a literal map instead of an app's HTTP
 * endpoint, keyed by type name. An unknown key or an `Error` value fails the
 * way the real lister does — a `ResourceListError`, never a bare throw — so the
 * callers under test take the same `resource_lookup_failed` branch they would
 * take against a bender that is down.
 */
export function stubResources(
  lists: Record<string, ResourceInstance[] | Error>,
): ResourceLister {
  return async ({ type }) => {
    const listed = lists[type.type]
    if (!listed || listed instanceof Error) {
      throw new ResourceListError(type.type, "unreachable", "stub")
    }
    return listed
  }
}

/**
 * The lister for a test that only ever grants flat permissions: any call to it
 * is itself the bug, and this one fails loudly rather than returning `[]`.
 */
export const noResources: ResourceLister = stubResources({})

/**
 * A kit context for `principal` in `tenant` (an app key, or null for the IdP
 * level): exactly what every surface builds, so a test calls
 * `ctx.services.<service>.<method>()` as the console and the API do.
 */
export function kitContext(
  ctx: BaseServiceContext,
  principal: IdpPrincipal | null,
  tenant: string | null,
  deps: { resources?: ResourceLister; auth?: AuthService; request?: Request } = {},
) {
  return app.context(principal, tenant, {
    base: ctx,
    auth: deps.auth ?? sessionlessAuth,
    resources: deps.resources ?? noResources,
    request: deps.request ?? new Request("https://idp.willy.im/"),
  })
}

/** A signed-in member of one app holding exactly `permissions` there. */
export function memberPrincipal(userId: string, app: string, permissions: AppPermission[]): IdpPrincipal {
  return { id: `user:${userId}`, grants: [], memberships: [{ tenantId: app, grants: permissions }] }
}

/** What a method failed with: `fail()`'s status and message, or kit's own 400/403/404. */
export async function failureOf(promise: Promise<unknown>): Promise<{ status: number; error: unknown }> {
  try {
    await promise
  } catch (e) {
    if (!(e instanceof Response)) throw e
    const text = await e.text()
    let error: unknown = text
    try {
      error = (JSON.parse(text) as { error?: unknown }).error
    } catch {}
    return { status: e.status, error }
  }
  throw new Error("expected the call to fail")
}

/** A signed-in human's principal, built by the real resolver from their rows. */
export async function signedInPrincipal(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
  input: { impersonatedBy?: string } = {},
): Promise<IdpPrincipal> {
  const principal = await principalFrom(new Request("https://idp.willy.im/"), ctx, sessionAuth(user, input))
  if (!principal) throw new Error("signedInPrincipal: the resolver rejected the session")
  return principal
}

/** A Better Auth stub whose session is `user`'s (impersonated by `impersonatedBy`). */
export function sessionAuth(
  user: { id: string; email: string },
  input: { impersonatedBy?: string } = {},
): AuthService {
  return {
    api: {
      getSession: async () => ({ user, session: { impersonatedBy: input.impersonatedBy ?? null } }),
    },
  } as unknown as AuthService
}

/** Replaces an app's declared product catalog in place, as the app re-declaring it would. */
export async function setCatalog(
  ctx: BaseServiceContext,
  app: string,
  catalog: { permissions?: string[]; resourceTypes?: ResourceTypeDecl[] },
) {
  const rows = await ctx.db.select().from(schema.oauthClient)
  const row = rows.find((r) => (r.metadata as { app?: string } | null)?.app === app)
  if (!row) throw new Error(`setCatalog: no app ${app}`)
  const metadata = row.metadata as Record<string, unknown>
  await ctx.db
    .update(schema.oauthClient)
    .set({
      metadata: {
        ...metadata,
        ...(catalog.permissions && { permissions: catalog.permissions }),
        ...(catalog.resourceTypes && { resource_types: catalog.resourceTypes }),
      },
    })
    .where(eq(schema.oauthClient.id, row.id))
}
