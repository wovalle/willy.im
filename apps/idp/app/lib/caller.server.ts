import { and, eq } from "drizzle-orm"
import { redirect } from "react-router"

import * as schema from "../db/schema"
import { hashToken } from "./api-keys.server"
import type { Actor } from "./audit.server"
import type { AuthService } from "./auth.server"
import {
  APP_PERMISSIONS,
  isAppPermission,
  resolvePermissions,
  type AppPermission,
} from "./permissions"
import type { BaseServiceContext } from "./services"

/**
 * One authorization object for both front doors. The console (cookie session)
 * and the management API (bearer token) resolve to the same {@link Caller}, so
 * every gate downstream asks the same question — "can this caller do X to app
 * Y?" — and nothing outside this file has to know how the caller arrived.
 */

const TOKEN_PREFIX = "wim_"

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
  /** May this caller perform `permission` against `app`? Memoized per app. */
  can(app: string, permission: AppPermission): Promise<boolean>
  /** Effective management permissions on `app` — for the UI to decide what to render. */
  permissionsFor(app: string): Promise<AppPermission[]>
  /**
   * Audit identity. Labels: "user:<id>" | "adminkey:<id>" | "apikey:<id>".
   * A superadmin via session is "user:<id>" (they're a real person); an
   * IdP-level key is "adminkey:<id>". Every superadmin action is therefore
   * attributable to one named, revocable credential — there is no anonymous
   * superadmin left.
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

/** Keep only catalog permissions (the catalog may have shrunk since the grant). */
function sanitizePermissions(permissions: string[]): AppPermission[] {
  return permissions.filter(isAppPermission)
}

/**
 * Where a superadmin came from. A union rather than nullable fields because
 * every superadmin now *has* an identity — an allowlisted human or a named
 * admin key — and the type is what guarantees the audit label can be built.
 */
type SuperadminOrigin =
  | { via: "session"; userId: string; email: string }
  | { via: "token"; keyId: string }

/** Every permission, every app. Used by both superadmin flavours. */
function superadminCaller(origin: SuperadminOrigin): Caller {
  return {
    kind: "superadmin",
    via: origin.via,
    userId: origin.via === "session" ? origin.userId : null,
    email: origin.via === "session" ? origin.email : null,
    keyId: origin.via === "token" ? origin.keyId : null,
    applicationId: null,
    can: async () => true,
    permissionsFor: async () => [...APP_PERMISSIONS],
    actor:
      origin.via === "session"
        ? { userId: origin.userId, label: `user:${origin.userId}` }
        : { userId: null, label: `adminkey:${origin.keyId}` },
  }
}

/**
 * A signed-in human with no IdP-level superpowers. Permissions come from their
 * `application_member` row, resolved per app and memoized in the closure — a
 * route that checks several permissions on one app pays a single query.
 */
function memberCaller(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
): Caller {
  const cache = new Map<string, Promise<AppPermission[]>>()

  const load = (app: string): Promise<AppPermission[]> => {
    const hit = cache.get(app)
    if (hit) return hit
    const pending = (async () => {
      const [member] = await ctx.db
        .select({
          role: schema.applicationMember.role,
          permissions: schema.applicationMember.permissions,
        })
        .from(schema.applicationMember)
        .where(
          and(
            eq(schema.applicationMember.applicationId, app),
            eq(schema.applicationMember.userId, user.id),
          ),
        )
        .limit(1)
      if (!member) return []
      return resolvePermissions(member.role, member.permissions ?? [])
    })()
    cache.set(app, pending)
    return pending
  }

  return {
    kind: "user",
    via: "session",
    userId: user.id,
    email: user.email,
    keyId: null,
    applicationId: null,
    can: async (app, permission) => (await load(app)).includes(permission),
    permissionsFor: load,
    actor: { userId: user.id, label: `user:${user.id}` },
  }
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

  // No app scope ⇒ IdP-level admin key: full superadmin authority, carrying an
  // identity the audit log can name and an admin can revoke.
  if (row.applicationId === null) {
    return superadminCaller({ via: "token", keyId: row.id })
  }

  const granted = sanitizePermissions(row.permissions ?? [])

  return {
    kind: "key",
    via: "token",
    userId: null,
    email: null,
    keyId: row.id,
    applicationId: row.applicationId,
    can: async (app, permission) => app === row.applicationId && granted.includes(permission),
    permissionsFor: async (app) => (app === row.applicationId ? granted : []),
    actor: { userId: null, label: `apikey:${row.id}` },
  }
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
  const user = { id: session.user.id, email: session.user.email }
  return isAdminEmail(ctx, user.email)
    ? superadminCaller({ via: "session", userId: user.id, email: user.email })
    : memberCaller(ctx, user)
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
  if (verdict === "forbidden") throw Response.json({ error: "forbidden" }, { status: 403 })
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
  if (!(await caller.can(app, permission))) {
    throw Response.json({ error: "forbidden" }, { status: 403 })
  }
}
