import { eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { hashToken } from "./api-keys.server"
import type { AuthService } from "./auth.server"
import { appRbac, isAppPermission, resolvePermissions } from "./permissions"
import type { BaseServiceContext } from "./services"

/**
 * Who is calling, as a kit principal: one door for every surface. The console
 * (cookie session), the generated HTTP API and MCP (bearer keys) all turn a
 * request into a principal here and hand it to `app.context` (kit.server.ts),
 * so nothing downstream has to know how the caller arrived.
 *
 * A principal holds global grants (`["*"]` for a superadmin) plus one
 * membership per app, with the app key as the tenant id. Its id is the audit
 * label: "user:<id>", "adminkey:<id>" or "apikey:<id>".
 */

const TOKEN_PREFIX = "wim_"

/** A kit principal over the IdP's management catalog. */
export type IdpPrincipal = NonNullable<Parameters<typeof appRbac.callerFor>[0]>

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

/**
 * A signed-in human. An allowlisted email is a superadmin (`grants: ["*"]`, no
 * memberships needed); anyone else gets one membership per `application_member`
 * row — the role's bag ∪ the row's explicit grants — loaded in one query.
 *
 * An impersonated session keeps the target's grants, but names the impersonator
 * as the principal's `actor`, and the audit trail records both.
 */
async function sessionPrincipal(
  ctx: BaseServiceContext,
  user: { id: string; email: string },
  impersonatorId: string | null,
): Promise<IdpPrincipal> {
  const id = `user:${user.id}`
  const actor = impersonatorId ? { id: `user:${impersonatorId}` } : undefined
  if (isAdminEmail(ctx, user.email)) return { id, grants: ["*"], memberships: [], actor }

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
  return { id, grants: [], memberships, actor }
}

/**
 * Resolves a `wim_` bearer token to a principal, or null if it is unknown,
 * revoked or expired. A null `applicationId` on the row means an IdP-level
 * admin key — a superadmin with a name, an expiry and a revoke switch
 * (`adminkey:<id>`); an app-bound key is one membership holding the key's
 * permissions (`apikey:<id>`), filtered to the catalog in case it shrank since
 * the key was minted. A hit bumps `lastUsedAt` best-effort.
 */
async function keyPrincipal(ctx: BaseServiceContext, token: string): Promise<IdpPrincipal | null> {
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

  if (row.applicationId === null) return { id: `adminkey:${row.id}`, grants: ["*"], memberships: [] }
  return {
    id: `apikey:${row.id}`,
    grants: [],
    memberships: [
      { tenantId: row.applicationId, grants: (row.permissions ?? []).filter(isAppPermission) },
    ],
  }
}

/**
 * The single door from a Request to who is calling: a kit principal, or null
 * when it carries no usable credential. Ids are the audit labels:
 * "user:<id>", "adminkey:<id>", "apikey:<id>".
 *
 * Bearer wins over cookie, and a *bad* bearer resolves to null rather than
 * falling through to the session: a request that presents a token is asking to
 * be judged as that token, and must not silently inherit session authority.
 * Every bearer is a key row we issued — there is no env-configured superadmin
 * secret — so anything without our prefix isn't worth a lookup.
 */
export async function principalFrom(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
): Promise<IdpPrincipal | null> {
  const token = extractBearer(request)
  if (token) return token.startsWith(TOKEN_PREFIX) ? keyPrincipal(ctx, token) : null
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  return sessionPrincipal(
    ctx,
    { id: session.user.id, email: session.user.email },
    session.session.impersonatedBy ?? null,
  )
}
