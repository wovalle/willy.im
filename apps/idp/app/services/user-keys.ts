import { declareService, fail, method } from "@willyim/kit"
import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { catalogOf, getApplicationByApp } from "../lib/admin.server"
import { generateToken, hashToken } from "../lib/api-keys.server"
import { APP_TOKEN_PREFIX, validateAppToken } from "../lib/app-tokens.server"
import { memberProductPermissions } from "../lib/claims.server"
import { appRbac } from "../lib/permissions"
import { requireScopes } from "../lib/scopes.server"
import { io } from "./io"

/**
 * End-user API keys — credentials an app's users create to call *that app's*
 * API. The IdP is the single key store: apps mint/list/revoke/validate here
 * (authenticated with their scoped `wim_` key) and never persist the
 * plaintext. Scopes are drawn from the app's declared product permission
 * catalog, and a key never carries more than its owner holds in the app — at
 * mint and at every validation. Enforcement is the app's job.
 */

const USER_TOKEN_PREFIX = "wak_"
const DISPLAY_PREFIX_LEN = USER_TOKEN_PREFIX.length + 8

/** Derived lifecycle state, shared with the management keys. */
export function statusOf(row: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()) {
  if (row.revokedAt) return "revoked" as const
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired" as const
  return "active" as const
}

export const user_keys = declareService((ctx) => ({
  list: method(
    {
      summary: "List the app's end-user API keys, newest first (never the secrets)",
      permission: "userkey:read",
      hints: { readOnly: true },
      ...io("user_keys.list"),
    },
    async ({ userId, workspaceId }) => {
      const conditions = [eq(schema.userApiKey.applicationId, ctx.app)]
      if (userId) conditions.push(eq(schema.userApiKey.userId, userId))
      if (workspaceId) conditions.push(eq(schema.userApiKey.workspaceId, workspaceId))
      const rows = await ctx.db
        .select()
        .from(schema.userApiKey)
        .where(and(...conditions))
        .orderBy(desc(schema.userApiKey.createdAt))
      return {
        keys: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          workspaceId: r.workspaceId ?? null,
          name: r.name,
          prefix: r.prefix,
          scopes: r.scopes ?? [],
          status: statusOf({ revokedAt: r.revokedAt, expiresAt: r.expiresAt }),
          createdAt: r.createdAt.toISOString(),
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt?.toISOString() ?? null,
        })),
      }
    },
  ),

  mint: method(
    {
      summary: "Mint an end-user API key for one of the app's users (the token is returned once)",
      description:
        "Every scope must be a declared permission or `<declared type>:<id>` for an instance the app currently lists, and the owner must hold it in the app (`<type>:*` covers its instances). Anything else is refused, not dropped: 422 names it, 502 when the app's list could not be read.",
      permission: "userkey:create",
      ...io("user_keys.mint"),
    },
    async (input) => {
      const [owner] = await ctx.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, input.userId))
        .limit(1)
      if (!owner) fail(404, `No user ${input.userId}.`)

      const catalog = catalogOf(await getApplicationByApp(ctx, ctx.app))
      const scopes = await requireScopes(input.scopes, ctx.app, catalog, ctx.resources)
      const held = (await memberProductPermissions(ctx.db, input.userId, ctx.app, catalog)) ?? []
      const notHeld = scopes.filter((s) => !appRbac.covers(held, [s]))
      if (notHeld.length) fail(422, `The owner doesn't hold: ${notHeld.join(", ")}`)

      const token = generateToken(USER_TOKEN_PREFIX)
      const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
      const id = crypto.randomUUID()
      const name = input.name.trim() || "Untitled key"
      await ctx.db.insert(schema.userApiKey).values({
        id,
        applicationId: ctx.app,
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        name,
        prefix,
        keyHash: await hashToken(token),
        scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      await ctx.audit.record({
        table: "user_api_key",
        operation: "create",
        rowId: id,
        after: { userId: input.userId, name, scopes },
      })
      return { id, token, prefix }
    },
  ),

  revoke: method(
    {
      summary: "Revoke an end-user API key (idempotent)",
      permission: "userkey:revoke",
      hints: { destructive: true, idempotent: true },
      ...io("user_keys.revoke"),
    },
    async ({ id }) => {
      // Scoped to the app, so one app can't revoke another's.
      const [row] = await ctx.db
        .select({ revokedAt: schema.userApiKey.revokedAt })
        .from(schema.userApiKey)
        .where(and(eq(schema.userApiKey.id, id), eq(schema.userApiKey.applicationId, ctx.app)))
        .limit(1)
      if (!row) fail(404, "Key not found.")
      if (!row.revokedAt) {
        await ctx.db
          .update(schema.userApiKey)
          .set({ revokedAt: new Date() })
          .where(eq(schema.userApiKey.id, id))
        await ctx.audit.record({ table: "user_api_key", operation: "revoke", rowId: id })
      }
      return { ok: true as const }
    },
  ),

  validate: method(
    {
      summary: "Validate a key presented to the app's API: an end-user key or an app token",
      description:
        "Answers for both credentials an app's API accepts: an end-user key (`wak_`, `kind: \"user\"`) and an app token (`wat_`, `kind: \"app\"`: an IdP superadmin acting in this app, named by `issuedBy`). A miss is data, not an error: `valid: false` and a reason. A user key whose owner left the app or no longer holds every scope reads `revoked` rather than shrinking; an app token reads `revoked` once its issuer lost superadmin. Not audited: this is the hot path.",
      permission: "userkey:validate",
      hints: { readOnly: true },
      ...io("user_keys.validate"),
    },
    async ({ token }) => {
      if (token.startsWith(APP_TOKEN_PREFIX)) return validateAppToken(ctx, { app: ctx.app, token })
      if (!token.startsWith(USER_TOKEN_PREFIX)) return { valid: false as const, reason: "not_found" as const }

      // By hash, and scoped to the app: a key minted for app A never validates for app B.
      const [row] = await ctx.db
        .select()
        .from(schema.userApiKey)
        .where(
          and(
            eq(schema.userApiKey.keyHash, await hashToken(token)),
            eq(schema.userApiKey.applicationId, ctx.app),
          ),
        )
        .limit(1)
      if (!row) return { valid: false as const, reason: "not_found" as const }
      if (row.revokedAt) return { valid: false as const, reason: "revoked" as const }
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now())
        return { valid: false as const, reason: "expired" as const }

      // Only as good as its owner: refused, never shrunk, once they lose a scope.
      const catalog = catalogOf(await getApplicationByApp(ctx, ctx.app))
      const held = await memberProductPermissions(ctx.db, row.userId, ctx.app, catalog)
      const scopes = row.scopes ?? []
      if (!held || !appRbac.covers(held, scopes)) {
        ctx.logger.warn("userkey.owner_lost_access", {
          keyId: row.id,
          userId: row.userId,
          reason: held ? "scopes_not_held" : "not_a_member",
        })
        return { valid: false as const, reason: "revoked" as const }
      }

      ctx.db
        .update(schema.userApiKey)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.userApiKey.id, row.id))
        .then(undefined, (err) =>
          ctx.logger.warn("userkey.last_used_update_failed", {
            keyId: row.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      return {
        valid: true as const,
        kind: "user" as const,
        keyId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId ?? null,
        scopes,
        name: row.name,
      }
    },
  ),
}))
