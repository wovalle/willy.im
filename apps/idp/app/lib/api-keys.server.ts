import { and, desc, eq, isNull } from "drizzle-orm"

import * as schema from "../db/schema"
import { IDP_AUDIT_SCOPE, recordAudit } from "./audit.server"
import { assertCan, type Caller } from "./caller.server"
import { isAppPermission, type AppPermission } from "./permissions"
import type { BaseServiceContext } from "./services"

/**
 * Scoped API keys — hashed, revocable, optionally-expiring credentials that let
 * an agent drive the management API for *one application* with a specific
 * permission set. The plaintext token is shown once at creation; only its
 * SHA-256 hash and a non-secret prefix are stored.
 */

const TOKEN_PREFIX = "wim_"
// Bytes of entropy in the random part of a token.
const TOKEN_BYTES = 32
// How many chars of the token (including the "wim_" prefix) we keep for display.
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 8

/** base64url without padding — URL/header safe, no `+` `/` `=`. */
function base64url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A fresh opaque token, e.g. `wim_X8f...`. Shared with user-api-keys (wak_). */
export function generateToken(prefix: string = TOKEN_PREFIX): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return prefix + base64url(bytes)
}

/** SHA-256(token) as lowercase hex. The stored lookup key. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Keep only catalog permissions. */
function sanitizePermissions(permissions: string[]): AppPermission[] {
  return permissions.filter(isAppPermission)
}

export type ApiKeySummary = {
  id: string
  name: string
  prefix: string
  permissions: AppPermission[]
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  /** Derived lifecycle state for the UI. */
  status: "active" | "expired" | "revoked"
}

function statusOf(row: { revokedAt: Date | null; expiresAt: Date | null }, now: Date) {
  if (row.revokedAt) return "revoked" as const
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired" as const
  return "active" as const
}

/** Keys for one application, newest first. Never returns the hash. Requires `apikey:read`. */
export async function listApiKeys(
  ctx: BaseServiceContext,
  caller: Caller,
  app: string,
): Promise<ApiKeySummary[]> {
  await assertCan(caller, app, "apikey:read")
  const now = new Date()
  const rows = await ctx.db
    .select({
      id: schema.apiKey.id,
      name: schema.apiKey.name,
      prefix: schema.apiKey.prefix,
      permissions: schema.apiKey.permissions,
      createdAt: schema.apiKey.createdAt,
      lastUsedAt: schema.apiKey.lastUsedAt,
      expiresAt: schema.apiKey.expiresAt,
      revokedAt: schema.apiKey.revokedAt,
    })
    .from(schema.apiKey)
    .where(eq(schema.apiKey.applicationId, app))
    .orderBy(desc(schema.apiKey.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    permissions: sanitizePermissions(r.permissions ?? []),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt ?? null,
    expiresAt: r.expiresAt ?? null,
    revokedAt: r.revokedAt ?? null,
    status: statusOf({ revokedAt: r.revokedAt ?? null, expiresAt: r.expiresAt ?? null }, now),
  }))
}

/**
 * Mints a new key for `app`. Returns the plaintext `token` exactly once — it is
 * never recoverable afterwards. `permissions` is filtered to the catalog.
 *
 * Requires `apikey:create`, *and* the requested permissions must be a subset of
 * the caller's own on that app. Without the subset rule any key holding
 * `apikey:create` could mint itself a strictly more powerful successor, which
 * makes every other permission on it decorative.
 */
export async function createApiKey(
  ctx: BaseServiceContext,
  caller: Caller,
  input: {
    app: string
    name: string
    permissions: string[]
    expiresAt?: Date | null
  },
): Promise<
  | { id: string; token: string; prefix: string }
  | { error: "permissions_exceed_caller"; detail: string[] }
> {
  await assertCan(caller, input.app, "apikey:create")

  const requested = sanitizePermissions(input.permissions)
  const held = new Set(await caller.permissionsFor(input.app))
  const excess = requested.filter((p) => !held.has(p))
  if (excess.length > 0) return { error: "permissions_exceed_caller", detail: excess }

  const token = generateToken()
  const keyHash = await hashToken(token)
  const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
  const id = crypto.randomUUID()
  const name = input.name.trim() || "Untitled key"
  const expiresAt = input.expiresAt ?? null

  await ctx.db.insert(schema.apiKey).values({
    id,
    applicationId: input.app,
    name,
    prefix,
    keyHash,
    permissions: requested,
    // Nullable: a scoped key or the static admin token has no human behind it.
    createdByUserId: caller.userId,
    expiresAt,
  })

  await recordAudit(ctx, {
    actor: caller.actor,
    table: "api_key",
    operation: "create",
    applicationId: input.app,
    rowId: id,
    after: { name, permissions: requested, expiresAt: expiresAt?.toISOString() ?? null },
  })

  return { id, token, prefix }
}

/**
 * Revokes a key (idempotent). Scoped to `app` so one app can't revoke another's.
 * Requires `apikey:revoke`.
 */
export async function revokeApiKey(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; id: string },
): Promise<{ ok: true } | { error: string }> {
  await assertCan(caller, input.app, "apikey:revoke")
  const [row] = await ctx.db
    .select({ id: schema.apiKey.id, revokedAt: schema.apiKey.revokedAt })
    .from(schema.apiKey)
    .where(and(eq(schema.apiKey.id, input.id), eq(schema.apiKey.applicationId, input.app)))
    .limit(1)
  if (!row) return { error: "Key not found." }
  if (!row.revokedAt) {
    await ctx.db
      .update(schema.apiKey)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKey.id, input.id))
    await recordAudit(ctx, {
      actor: caller.actor,
      table: "api_key",
      operation: "revoke",
      applicationId: input.app,
      rowId: input.id,
    })
  }
  return { ok: true }
}

/**
 * IdP-level admin keys: `api_key` rows with a NULL `application_id`, which the
 * resolver turns into superadmin callers. They exist so automation stops
 * sharing the one static ADMIN_API_TOKEN — each agent gets its own named,
 * expiring, revocable credential that shows up in the audit log as
 * `adminkey:<id>` instead of an anonymous `superadmin-token`.
 */

/** Superadmin-only gate, throwing the same 403 shape `assertCan` does. */
function assertSuperadmin(caller: Caller): void {
  if (caller.kind !== "superadmin") throw Response.json({ error: "forbidden" }, { status: 403 })
}

/** Every IdP-level admin key, newest first. Never returns the hash. Superadmin only. */
export async function listAdminKeys(
  ctx: BaseServiceContext,
  caller: Caller,
): Promise<ApiKeySummary[]> {
  assertSuperadmin(caller)
  const now = new Date()
  const rows = await ctx.db
    .select({
      id: schema.apiKey.id,
      name: schema.apiKey.name,
      prefix: schema.apiKey.prefix,
      createdAt: schema.apiKey.createdAt,
      lastUsedAt: schema.apiKey.lastUsedAt,
      expiresAt: schema.apiKey.expiresAt,
      revokedAt: schema.apiKey.revokedAt,
    })
    .from(schema.apiKey)
    .where(isNull(schema.apiKey.applicationId))
    .orderBy(desc(schema.apiKey.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    // Always empty: an admin key holds every permission by virtue of being
    // unscoped, so the column would only ever be a misleading second opinion.
    permissions: [],
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt ?? null,
    expiresAt: r.expiresAt ?? null,
    revokedAt: r.revokedAt ?? null,
    status: statusOf({ revokedAt: r.revokedAt ?? null, expiresAt: r.expiresAt ?? null }, now),
  }))
}

/**
 * Mints an IdP-level admin key. Superadmin only — and since the new key *is* a
 * superadmin, there is no subset rule to apply: the caller already holds
 * everything it could possibly grant.
 *
 * Returns the plaintext `token` exactly once; it is never recoverable after.
 */
export async function createAdminKey(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { name: string; expiresAt?: Date | null },
): Promise<{ id: string; token: string; prefix: string }> {
  assertSuperadmin(caller)

  const token = generateToken()
  const keyHash = await hashToken(token)
  const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
  const id = crypto.randomUUID()
  const name = input.name.trim() || "Untitled admin key"
  const expiresAt = input.expiresAt ?? null

  await ctx.db.insert(schema.apiKey).values({
    id,
    // The whole point: no app scope ⇒ every permission on every app.
    applicationId: null,
    name,
    prefix,
    keyHash,
    // Meaningless for an admin key — see listAdminKeys.
    permissions: [],
    // Null when the static token or another admin key mints this one.
    createdByUserId: caller.userId,
    expiresAt,
  })

  await recordAudit(ctx, {
    actor: caller.actor,
    table: "api_key",
    operation: "create",
    applicationId: IDP_AUDIT_SCOPE,
    rowId: id,
    after: { name, expiresAt: expiresAt?.toISOString() ?? null },
  })

  return { id, token, prefix }
}

/**
 * Revokes an admin key (idempotent). Superadmin only. Scoped to unscoped rows,
 * so this can never reach into an app's own keys.
 *
 * A key may revoke *itself*: an agent cleaning up its own credential when it
 * finishes is the point, not an accident. It is logged at warn so the
 * surprising aftermath ("my key stopped working") is greppable.
 */
export async function revokeAdminKey(
  ctx: BaseServiceContext,
  caller: Caller,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  assertSuperadmin(caller)
  const [row] = await ctx.db
    .select({ id: schema.apiKey.id, revokedAt: schema.apiKey.revokedAt })
    .from(schema.apiKey)
    .where(and(eq(schema.apiKey.id, id), isNull(schema.apiKey.applicationId)))
    .limit(1)
  if (!row) return { error: "Key not found." }
  if (caller.keyId === id) ctx.logger.warn("adminkey.self_revoke", { keyId: id })
  if (!row.revokedAt) {
    await ctx.db
      .update(schema.apiKey)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKey.id, id))
    await recordAudit(ctx, {
      actor: caller.actor,
      table: "api_key",
      operation: "revoke",
      applicationId: IDP_AUDIT_SCOPE,
      rowId: id,
    })
  }
  return { ok: true }
}
