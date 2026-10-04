import { declareService, fail, method } from "@willyim/kit"
import { and, desc, eq, isNull } from "drizzle-orm"

import * as schema from "../db/schema"
import { generateToken, hashToken } from "../lib/api-keys.server"
import { isAppPermission } from "../lib/permissions"
import { io } from "./io"
import { statusOf } from "./user-keys"

/**
 * Management keys (`wim_`): hashed, revocable, optionally expiring credentials
 * that drive the IdP for ONE app with a fixed set of management permissions.
 * The plaintext is shown once at mint; only its SHA-256 and a non-secret
 * prefix are stored.
 */

const TOKEN_PREFIX = "wim_"
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 8

type KeyRow = Pick<
  schema.ApiKey,
  "id" | "name" | "prefix" | "permissions" | "createdAt" | "lastUsedAt" | "expiresAt" | "revokedAt"
>

/** A key row on the wire: never the hash, dates as ISO, its lifecycle state derived. */
export const toKey = (r: KeyRow) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  permissions: (r.permissions ?? []).filter(isAppPermission),
  status: statusOf(r),
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
})

/** A fresh `wim_` token, what the row stores of it, and its id. */
export async function newKey() {
  const token = generateToken(TOKEN_PREFIX)
  return {
    id: crypto.randomUUID(),
    token,
    prefix: token.slice(0, DISPLAY_PREFIX_LEN),
    keyHash: await hashToken(token),
  }
}

export const management_keys = declareService((ctx) => ({
  list: method(
    {
      summary: "List the app's management keys, newest first (never the secrets)",
      permission: "apikey:read",
      hints: { readOnly: true },
      ...io("management_keys.list"),
    },
    async () => {
      const rows = await ctx.db
        .select()
        .from(schema.apiKey)
        .where(eq(schema.apiKey.applicationId, ctx.app))
        .orderBy(desc(schema.apiKey.createdAt))
      return { keys: rows.map(toKey) }
    },
  ),

  mint: method(
    {
      summary: "Mint a management key for the app (the token is returned once)",
      description:
        "The key holds the given management permissions (ones outside the catalog are dropped), all of which the caller must hold in the app: without that rule any key holding `apikey:create` could mint itself a more powerful successor (403 names the excess).",
      permission: "apikey:create",
      ...io("management_keys.mint"),
    },
    async (input) => {
      const permissions = input.permissions.filter(isAppPermission)
      const excess = permissions.filter((p) => !ctx.caller.has(p))
      if (excess.length) fail(403, `You can't grant permissions you don't hold: ${excess.join(", ")}.`)

      const key = await newKey()
      const name = input.name.trim() || "Untitled key"
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
      await ctx.db.insert(schema.apiKey).values({
        id: key.id,
        applicationId: ctx.app,
        name,
        prefix: key.prefix,
        keyHash: key.keyHash,
        permissions,
        // Null for a key minting a key: no human behind it.
        createdByUserId: ctx.userId,
        expiresAt,
      })
      await ctx.audit.record({
        table: "api_key",
        operation: "create",
        rowId: key.id,
        after: { name, permissions, expiresAt: expiresAt?.toISOString() ?? null },
      })
      return { id: key.id, token: key.token, prefix: key.prefix }
    },
  ),

  revoke: method(
    {
      summary: "Revoke a management key of the app (idempotent)",
      permission: "apikey:revoke",
      hints: { destructive: true, idempotent: true },
      ...io("management_keys.revoke"),
    },
    async ({ id }) => {
      // Scoped to the app, so one app can't revoke another's (or an admin key).
      const [row] = await ctx.db
        .select({ revokedAt: schema.apiKey.revokedAt })
        .from(schema.apiKey)
        .where(and(eq(schema.apiKey.id, id), eq(schema.apiKey.applicationId, ctx.app)))
        .limit(1)
      if (!row) fail(404, "Key not found.")
      if (!row.revokedAt) {
        await ctx.db.update(schema.apiKey).set({ revokedAt: new Date() }).where(eq(schema.apiKey.id, id))
        await ctx.audit.record({ table: "api_key", operation: "revoke", rowId: id })
      }
      return { ok: true as const }
    },
  ),
}))

/**
 * IdP-level admin keys: `api_key` rows with no app, which the resolver turns
 * into superadmins (`adminkey:<id>`). The only superadmin credential the IdP
 * accepts over the wire, so automation never shares one anonymous secret: each
 * agent gets its own named, expiring, revocable key the audit log names.
 */
export const admin_keys = declareService((ctx) => ({
  list: method(
    {
      summary: "List the IdP's admin keys, newest first (never the secrets)",
      permission: "*",
      hints: { readOnly: true },
      ...io("admin_keys.list"),
    },
    async () => {
      const rows = await ctx.db
        .select()
        .from(schema.apiKey)
        .where(isNull(schema.apiKey.applicationId))
        .orderBy(desc(schema.apiKey.createdAt))
      // No permissions column on the wire: an admin key holds everything by being unscoped.
      return { keys: rows.map(({ permissions: _, ...r }) => toKey({ ...r, permissions: [] })) }
    },
  ),

  mint: method(
    {
      summary: "Mint an IdP admin key: a superadmin over every app (the token is returned once)",
      description:
        "Mint one per agent: an admin key has a name, an optional expiry, a revoke switch, and its own `adminkey:<id>` identity in the audit log, so every superadmin action is attributable.",
      permission: "*",
      ...io("admin_keys.mint"),
    },
    async (input) => {
      const key = await newKey()
      const name = input.name.trim() || "Untitled admin key"
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
      await ctx.db.insert(schema.apiKey).values({
        id: key.id,
        // The whole point: no app ⇒ every permission on every app.
        applicationId: null,
        name,
        prefix: key.prefix,
        keyHash: key.keyHash,
        permissions: [],
        createdByUserId: ctx.userId,
        expiresAt,
      })
      await ctx.audit.record({
        table: "api_key",
        operation: "create",
        rowId: key.id,
        after: { name, expiresAt: expiresAt?.toISOString() ?? null },
      })
      return { id: key.id, token: key.token, prefix: key.prefix }
    },
  ),

  revoke: method(
    {
      summary: "Revoke an IdP admin key (idempotent; a key may revoke itself)",
      description:
        "An agent cleaning up its own key when it finishes is the point, not an accident: its next request is simply unauthorized. Never reaches an app's own keys.",
      permission: "*",
      hints: { destructive: true, idempotent: true },
      ...io("admin_keys.revoke"),
    },
    async ({ id }) => {
      const [row] = await ctx.db
        .select({ revokedAt: schema.apiKey.revokedAt })
        .from(schema.apiKey)
        .where(and(eq(schema.apiKey.id, id), isNull(schema.apiKey.applicationId)))
        .limit(1)
      if (!row) fail(404, "Key not found.")
      if (ctx.keyId === id) ctx.logger.warn("adminkey.self_revoke", { keyId: id })
      if (!row.revokedAt) {
        await ctx.db.update(schema.apiKey).set({ revokedAt: new Date() }).where(eq(schema.apiKey.id, id))
        await ctx.audit.record({ table: "api_key", operation: "revoke", rowId: id })
      }
      return { ok: true as const }
    },
  ),
}))
