import { and, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { hashToken } from "./api-keys.server"
import { isAdminEmail } from "./caller.server"
import type { BaseServiceContext } from "./services"

/**
 * App tokens — GitHub-App-style installation tokens. An IdP admin key is the
 * private key, and never goes to an app: a superadmin exchanges their authority
 * here for a `wat_` token bound to one app, living an hour at most. The app
 * validates it like an end-user key (`user_keys.validate` answers `kind: "app"`) and
 * treats it as the issuer acting in the app — `["*"]` unless narrowed at mint.
 */

export const APP_TOKEN_PREFIX = "wat_"

export type AppTokenValidation =
  | {
      valid: true
      kind: "app"
      keyId: string
      /** The issuer, as the principal id the app acts as: "adminkey:<id>" | "user:<id>". */
      issuedBy: string
      workspaceId: string | null
      scopes: string[]
      /** The issuing admin key's name, or the issuing admin's email. */
      name: string
    }
  | { valid: false; reason: "not_found" | "revoked" | "expired" }

/**
 * The `wat_` half of `user_keys.validate` (services/user-keys.ts), which holds the
 * `userkey:validate` check for both kinds. Scoped to `app`, so a token minted
 * for app A never validates for app B.
 *
 * A token is only as good as its issuer: once the admin key that minted it is
 * revoked or expired, or its human leaves ADMIN_EMAILS, it is refused. The
 * response reads `revoked`; the log says why.
 */
export async function validateAppToken(
  ctx: BaseServiceContext,
  input: { app: string; token: string },
): Promise<AppTokenValidation> {
  const keyHash = await hashToken(input.token)
  const [row] = await ctx.db
    .select({
      id: schema.appToken.id,
      scopes: schema.appToken.scopes,
      workspaceId: schema.appToken.workspaceId,
      expiresAt: schema.appToken.expiresAt,
      keyId: schema.appToken.issuedByKeyId,
      keyName: schema.apiKey.name,
      keyRevokedAt: schema.apiKey.revokedAt,
      keyExpiresAt: schema.apiKey.expiresAt,
      userId: schema.appToken.issuedByUserId,
      email: schema.user.email,
    })
    .from(schema.appToken)
    .leftJoin(schema.apiKey, eq(schema.apiKey.id, schema.appToken.issuedByKeyId))
    .leftJoin(schema.user, eq(schema.user.id, schema.appToken.issuedByUserId))
    .where(and(eq(schema.appToken.keyHash, keyHash), eq(schema.appToken.applicationId, input.app)))
    .limit(1)

  if (!row) return { valid: false, reason: "not_found" }
  if (row.expiresAt.getTime() <= Date.now()) return { valid: false, reason: "expired" }

  const issuer = issuerOf(ctx, row)
  if ("lost" in issuer) {
    ctx.logger.warn("apptoken.issuer_lost_access", {
      keyId: row.id,
      issuedBy: issuer.id,
      reason: issuer.lost,
    })
    return { valid: false, reason: "revoked" }
  }

  return {
    valid: true,
    kind: "app",
    keyId: row.id,
    issuedBy: issuer.id,
    workspaceId: row.workspaceId ?? null,
    scopes: row.scopes,
    name: issuer.name,
  }
}

/**
 * Who minted a token, if they still could: the principal id it acts as and a
 * name for humans, or why not. Both issuer columns null means the issuer's row
 * is gone (`on delete set null`).
 */
function issuerOf(
  ctx: BaseServiceContext,
  row: {
    keyId: string | null
    keyName: string | null
    keyRevokedAt: Date | null
    keyExpiresAt: Date | null
    userId: string | null
    email: string | null
  },
):
  | { id: string; name: string }
  | { id: string | null; lost: "issuer_deleted" | "key_revoked" | "key_expired" | "not_an_admin" } {
  if (row.keyId) {
    const id = `adminkey:${row.keyId}`
    if (row.keyName === null) return { id, lost: "issuer_deleted" }
    if (row.keyRevokedAt) return { id, lost: "key_revoked" }
    if (row.keyExpiresAt && row.keyExpiresAt.getTime() <= Date.now())
      return { id, lost: "key_expired" }
    return { id, name: row.keyName }
  }
  if (row.userId) {
    const id = `user:${row.userId}`
    if (row.email === null) return { id, lost: "issuer_deleted" }
    if (!isAdminEmail(ctx, row.email)) return { id, lost: "not_an_admin" }
    return { id, name: row.email }
  }
  return { id: null, lost: "issuer_deleted" }
}
