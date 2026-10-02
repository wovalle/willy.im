import { eq } from "drizzle-orm"
import { redirect } from "react-router"

import * as schema from "../db/schema"
import { hashToken } from "./api-keys.server"
import type { Actor } from "./audit.server"
import type { AuthService } from "./auth.server"
import { appRbac, isAppPermission, resolvePermissions, type AppPermission } from "./permissions"
import type { BaseServiceContext } from "./services"

/**
 * One authorization object for both front doors. The console (cookie session)
 * and the management API (bearer token) resolve to the same {@link Caller}, so
 * every gate downstream asks the same question — "can this caller do X to app
 * Y?" — and nothing outside this file has to know how the caller arrived.
 *
 * Underneath, every caller is a kit `Principal`: global grants (`["*"]` for a
 * superadmin) plus one membership per app, with the app key as the tenant id.
 * What a caller may do on an app is `appRbac.callerFor(principal, app)`.
 */

const TOKEN_PREFIX = "wim_"

/** A kit principal over the IdP's management catalog. */
export type IdpPrincipal = NonNullable<Parameters<typeof appRbac.callerFor>[0]>

export type Caller = {
  kind: "superadmin" | "user" | "key"
  /** How the caller authenticated. Only the resolver should ever branch on it. */
  via: "session" | "token"
  /** Human identity, when there is one. Null for keys. */
  userId: string | null
  email: string | null
  /** Management key identity — admin key or scoped key. Null for humans. */
  keyId: string | null
  /** The app a scoped key is bound to. Null means not app-bound. */
  applicationId: string | null
  /** Who is calling, as grants: the source of every answer below. */
  principal: IdpPrincipal
  /** May this caller perform `permission` against `app`? */
  can(app: string, permission: AppPermission): Promise<boolean>
  /** Effective management permissions on `app` — for the UI to decide what to render. */
  permissionsFor(app: string): Promise<AppPermission[]>
  /**
   * Audit identity. Labels: "user:<id>" | "adminkey:<id>" | "apikey:<id>", the
   * principal id. A superadmin via session is "user:<id>" (they're a real
   * person); an IdP-level key is "adminkey:<id>". Every superadmin action is
   * therefore attributable to one named, revocable credential — there is no
   * anonymous superadmin left. An impersonated session reads
   * "user:<impersonator> as user:<target>", with the impersonator as `userId`.
   */
  actor: Actor
}

function adminEmails(ctx: BaseServiceContext): string[] {
  return ctx
    .getAppEnv("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Is `email` on the IdP-level superadmin allowlist (env ADMIN_EMAILS)? */
export function isAdminEmail(ctx: BaseServiceContext, email?: string | null) {
  return !!email && adminEmails(ctx).includes(email.toLowerCase())
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 })

/**
 * The principal's caller on `app`, or null when it holds nothing there. kit
 * answers a tenant the principal has no membership in (and no global grants)
 * with a 404 so tenants don't leak; here that just means "no permissions".
 */
function inApp(principal: IdpPrincipal, app: string) {
  try {
    return appRbac.callerFor(principal, app)
  } catch (err) {
    if (err instanceof Response && err.status === 404) return null
    throw err
  }
}

/**
 * Wraps a principal in the {@link Caller} the gates and services read. `kind`
 * follows the grants: a principal holding `"*"` is a superadmin however it
 * arrived. Exported so tests build callers the way the resolver does.
 */
export function callerFromPrincipal(
  principal: IdpPrincipal,
  identity: Pick<Caller, "via" | "userId" | "email" | "keyId" | "applicationId" | "actor">,
): Caller {
  const superadmin = appRbac.callerFor(principal, null).isSuperadmin
  return {
    ...identity,
    kind: superadmin ? "superadmin" : identity.keyId ? "key" : "user",
    principal,
    can: async (app, permission) => inApp(principal, app)?.has(permission) ?? false,
    permissionsFor: async (app) => inApp(principal, app)?.granted ?? [],
  }
}

/**
 * A signed-in human. An allowlisted email is a superadmin (`grants: ["*"]`, no
 * memberships needed); anyone else gets one membership per `application_member`
 * row — the role's bag ∪ the row's explicit grants — loaded in one query.
 *
 * An impersonated session keeps the target's grants, but names the impersonator
 * as the principal's `actor`, and the audit trail records both.
 */
async function sessionCaller(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
  impersonatorId: string | null,
): Promise<Caller> {
  const id = `user:${user.id}`
  const actor = impersonatorId ? { id: `user:${impersonatorId}` } : undefined
  const identity = {
    via: "session" as const,
    userId: user.id,
    email: user.email,
    keyId: null,
    applicationId: null,
    actor: impersonatorId
      ? { userId: impersonatorId, label: `user:${impersonatorId} as ${id}` }
      : { userId: user.id, label: id },
  }

  if (isAdminEmail(ctx, user.email))
    return callerFromPrincipal({ id, grants: ["*"], memberships: [], actor }, identity)

  const rows = await ctx.db
    .select({
      applicationId: schema.applicationMember.applicationId,
      role: schema.applicationMember.role,
      permissions: schema.applicationMember.permissions,
    })
    .from(schema.applicationMember)
    .where(eq(schema.applicationMember.userId, user.id))
  const memberships = rows.map((row) => ({
    tenantId: row.applicationId,
    grants: resolvePermissions(row.role, row.permissions ?? []),
  }))
  return callerFromPrincipal({ id, grants: [], memberships, actor }, identity)
}

/**
 * Resolves a `wim_` bearer token to a caller, or null if it is unknown, revoked
 * or expired. A null `applicationId` on the row means an IdP-level admin key —
 * a superadmin with a name, an expiry and a revoke switch. A hit bumps
 * `lastUsedAt` best-effort.
 */
async function keyCaller(ctx: BaseServiceContext, token: string): Promise<Caller | null> {
  const keyHash = await hashToken(token)
  const [row] = await ctx.db
    .select({
      id: schema.apiKey.id,
      applicationId: schema.apiKey.applicationId,
      permissions: schema.apiKey.permissions,
      expiresAt: schema.apiKey.expiresAt,
      revokedAt: schema.apiKey.revokedAt,
    })
    .from(schema.apiKey)
    .where(eq(schema.apiKey.keyHash, keyHash))
    .limit(1)

  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null

  // Best effort — a failed lastUsedAt update must not deny an otherwise-valid key.
  ctx.db
    .update(schema.apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKey.id, row.id))
    .then(undefined, (err) =>
      ctx.logger.warn("apikey.last_used_update_failed", {
        keyId: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    )

  const identity = { via: "token" as const, userId: null, email: null, keyId: row.id }

  // No app scope ⇒ IdP-level admin key: full superadmin authority, carrying an
  // identity the audit log can name and an admin can revoke.
  if (row.applicationId === null) {
    const id = `adminkey:${row.id}`
    return callerFromPrincipal(
      { id, grants: ["*"], memberships: [] },
      { ...identity, applicationId: null, actor: { userId: null, label: id } },
    )
  }

  // App-bound: one membership holding the key's permissions (filtered to the
  // catalog, in case it shrank since the key was minted).
  const id = `apikey:${row.id}`
  return callerFromPrincipal(
    {
      id,
      grants: [],
      memberships: [
        { tenantId: row.applicationId, grants: (row.permissions ?? []).filter(isAppPermission) },
      ],
    },
    { ...identity, applicationId: row.applicationId, actor: { userId: null, label: id } },
  )
}

/**
 * The single entry point that turns a Request into a {@link Caller}, or null if
 * it carries no usable credential.
 *
 * Bearer wins over cookie, and a *bad* bearer resolves to null rather than
 * falling through to the session: a request that presents a token is asking to
 * be judged as that token, and must not silently inherit session authority.
 */
export async function resolveCaller(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
): Promise<Caller | null> {
  const token = extractBearer(request)
  if (token) {
    // Every bearer is a key row we issued — there is no env-configured
    // superadmin secret. Anything without our prefix isn't worth a lookup.
    if (!token.startsWith(TOKEN_PREFIX)) return null
    return keyCaller(ctx, token)
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  return sessionCaller(
    ctx,
    { id: session.user.id, email: session.user.email },
    session.session.impersonatedBy ?? null,
  )
}

/** What a gate demands: IdP-level superadmin, or a permission on one app. */
export type Need = { superadmin: true } | { app: string; permission: AppPermission }

/**
 * The one authorization core. Both front doors funnel through it, so the
 * console and the API can never drift apart on what "allowed" means.
 */
export async function authorize(
  caller: Caller | null,
  need?: Need,
): Promise<"ok" | "unauthenticated" | "forbidden"> {
  if (!caller) return "unauthenticated"
  if (!need) return "ok"
  if ("superadmin" in need) return caller.kind === "superadmin" ? "ok" : "forbidden"
  return (await caller.can(need.app, need.permission)) ? "ok" : "forbidden"
}

/**
 * Management-API gate. Throws the JSON 401/403 shapes clients already parse.
 */
export async function requireApiCaller(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
  need?: Need,
): Promise<Caller> {
  const caller = await resolveCaller(request, ctx, auth)
  const verdict = await authorize(caller, need)
  if (verdict === "unauthenticated") throw Response.json({ error: "unauthorized" }, { status: 401 })
  if (verdict === "forbidden") throw forbidden()
  return caller as Caller
}

/**
 * Console gate. Anonymous callers go to /login; authenticated-but-forbidden
 * ones go to /account, which is what the old admin gate did — a bounce beats a
 * dead end for someone who simply isn't an admin. (A real 403 page would be
 * more honest about *why*; that's a follow-up, not this refactor.)
 */
export async function requireConsoleCaller(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
  need?: Need,
): Promise<Caller> {
  const caller = await resolveCaller(request, ctx, auth)
  const verdict = await authorize(caller, need)
  ctx.logger.info("admin.gate", {
    hasSession: !!caller,
    email: caller?.email ?? undefined,
    admin: caller?.kind === "superadmin",
    verdict,
  })
  if (verdict === "unauthenticated") throw redirect("/login")
  if (verdict === "forbidden") throw redirect("/account")
  return caller as Caller
}

/**
 * Per-intent check inside an already-authenticated console action. Throws the
 * same 403 the API gate does, so a forbidden intent fails loudly instead of
 * bouncing a signed-in user out of the page they're on.
 */
export async function assertCan(
  caller: Caller,
  app: string,
  permission: AppPermission,
): Promise<void> {
  if (!(await caller.can(app, permission))) throw forbidden()
}

/** Superadmin-only gate, throwing the same 403 shape `assertCan` does. */
export function assertSuperadmin(caller: Caller): void {
  if (caller.kind !== "superadmin") throw forbidden()
}

/**
 * Throws the same 403 unless the caller covers every grant in `wanted` on `app`:
 * whoever hands out grants (an invite, a role change) must hold them first.
 */
export function assertCovers(caller: Caller, app: string, wanted: readonly string[]): void {
  if (!appRbac.covers(inApp(caller.principal, app)?.grants ?? [], wanted)) throw forbidden()
}
