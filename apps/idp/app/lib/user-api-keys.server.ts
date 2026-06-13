import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { getApplicationByApp } from "./admin.server"
import { generateToken, hashToken } from "./api-keys.server"
import type { BaseServiceContext } from "./services"

/**
 * End-user API keys — credentials an app's users create to call *that app's*
 * API. The IdP is the single key store: apps mint/list/revoke/validate through
 * the management API (authenticated with their scoped `wim_` key) and never
 * persist the plaintext. Scopes are drawn from the app's declared product
 * permission catalog; enforcement is the app's job.
 */

const USER_TOKEN_PREFIX = "wak_"
const DISPLAY_PREFIX_LEN = USER_TOKEN_PREFIX.length + 8

export type UserApiKeySummary = {
  id: string
  userId: string
  workspaceId: string | null
  name: string
  prefix: string
  scopes: string[]
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  status: "active" | "expired" | "revoked"
}

function statusOf(row: { revokedAt: Date | null; expiresAt: Date | null }, now: Date) {
  if (row.revokedAt) return "revoked" as const
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired" as const
  return "active" as const
}

/** Keys for one app, optionally filtered by user/workspace. Never returns hashes. */
export async function listUserApiKeys(
  ctx: BaseServiceContext,
  input: { app: string; userId?: string; workspaceId?: string },
): Promise<UserApiKeySummary[]> {
  const now = new Date()
  const conditions = [eq(schema.userApiKey.applicationId, input.app)]
  if (input.userId) conditions.push(eq(schema.userApiKey.userId, input.userId))
  if (input.workspaceId) conditions.push(eq(schema.userApiKey.workspaceId, input.workspaceId))

  const rows = await ctx.db
    .select()
    .from(schema.userApiKey)
    .where(and(...conditions))
    .orderBy(desc(schema.userApiKey.createdAt))

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    workspaceId: r.workspaceId ?? null,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes ?? [],
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt ?? null,
    expiresAt: r.expiresAt ?? null,
    revokedAt: r.revokedAt ?? null,
    status: statusOf({ revokedAt: r.revokedAt ?? null, expiresAt: r.expiresAt ?? null }, now),
  }))
}

/**
 * Mints a key for one of the app's users. Returns the plaintext exactly once.
 * Scopes are validated against the app's declared catalog; unknown scopes are
 * rejected (not silently dropped) so the caller learns about the mismatch.
 */
export async function createUserApiKey(
  ctx: BaseServiceContext,
  input: {
    app: string
    userId: string
    name: string
    scopes?: string[]
    workspaceId?: string | null
    expiresAt?: Date | null
  },
): Promise<
  | { id: string; token: string; prefix: string }
  | { error: "unknown_user" | "unknown_scopes"; detail?: string[] }
> {
  const [u] = await ctx.db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .limit(1)
  if (!u) return { error: "unknown_user" }

  const scopes = [...new Set((input.scopes ?? []).map((s) => s.trim()).filter(Boolean))]
  if (scopes.length) {
    const application = await getApplicationByApp(ctx, input.app)
    const catalog = new Set(application?.permissions ?? [])
    const unknown = scopes.filter((s) => !catalog.has(s))
    if (unknown.length) return { error: "unknown_scopes", detail: unknown }
  }

  const token = generateToken(USER_TOKEN_PREFIX)
  const keyHash = await hashToken(token)
  const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
  const id = crypto.randomUUID()

  await ctx.db.insert(schema.userApiKey).values({
    id,
    applicationId: input.app,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    name: input.name.trim() || "Untitled key",
    prefix,
    keyHash,
    scopes,
    expiresAt: input.expiresAt ?? null,
  })

  return { id, token, prefix }
}

/** Revokes a key (idempotent). Scoped to `app` so one app can't revoke another's. */
export async function revokeUserApiKey(
  ctx: BaseServiceContext,
  input: { app: string; id: string },
): Promise<{ ok: true } | { error: string }> {
  const [row] = await ctx.db
    .select({ id: schema.userApiKey.id, revokedAt: schema.userApiKey.revokedAt })
    .from(schema.userApiKey)
    .where(and(eq(schema.userApiKey.id, input.id), eq(schema.userApiKey.applicationId, input.app)))
    .limit(1)
  if (!row) return { error: "Key not found." }
  if (!row.revokedAt) {
    await ctx.db
      .update(schema.userApiKey)
      .set({ revokedAt: new Date() })
      .where(eq(schema.userApiKey.id, input.id))
  }
  return { ok: true }
}

export type UserApiKeyValidation =
  | {
      valid: true
      keyId: string
      userId: string
      workspaceId: string | null
      scopes: string[]
      name: string
    }
  | { valid: false; reason: "not_found" | "revoked" | "expired" }

/**
 * Validates a presented token for `app`. The lookup is by SHA-256 hash and
 * scoped to the calling app, so a key minted for app A never validates for app
 * B. A hit bumps lastUsedAt (best effort).
 */
export async function validateUserApiKey(
  ctx: BaseServiceContext,
  input: { app: string; token: string },
): Promise<UserApiKeyValidation> {
  if (!input.token.startsWith(USER_TOKEN_PREFIX)) return { valid: false, reason: "not_found" }

  const keyHash = await hashToken(input.token)
  const [row] = await ctx.db
    .select()
    .from(schema.userApiKey)
    .where(
      and(
        eq(schema.userApiKey.keyHash, keyHash),
        eq(schema.userApiKey.applicationId, input.app),
      ),
    )
    .limit(1)

  if (!row) return { valid: false, reason: "not_found" }
  if (row.revokedAt) return { valid: false, reason: "revoked" }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { valid: false, reason: "expired" }

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
    valid: true,
    keyId: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId ?? null,
    scopes: row.scopes ?? [],
    name: row.name,
  }
}
