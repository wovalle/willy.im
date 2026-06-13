import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { APP_PERMISSIONS, type AppPermission } from "./permissions"
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
  return permissions.filter((p): p is AppPermission =>
    (APP_PERMISSIONS as readonly string[]).includes(p),
  )
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

/** Keys for one application, newest first. Never returns the hash. */
export async function listApiKeys(
  ctx: BaseServiceContext,
  app: string,
): Promise<ApiKeySummary[]> {
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
 */
export async function createApiKey(
  ctx: BaseServiceContext,
  input: {
    app: string
    name: string
    permissions: string[]
    createdByUserId: string
    expiresAt?: Date | null
  },
): Promise<{ id: string; token: string; prefix: string }> {
  const token = generateToken()
  const keyHash = await hashToken(token)
  const prefix = token.slice(0, DISPLAY_PREFIX_LEN)
  const id = crypto.randomUUID()

  await ctx.db.insert(schema.apiKey).values({
    id,
    applicationId: input.app,
    name: input.name.trim() || "Untitled key",
    prefix,
    keyHash,
    permissions: sanitizePermissions(input.permissions),
    createdByUserId: input.createdByUserId,
    expiresAt: input.expiresAt ?? null,
  })

  return { id, token, prefix }
}

/** Revokes a key (idempotent). Scoped to `app` so one app can't revoke another's. */
export async function revokeApiKey(
  ctx: BaseServiceContext,
  input: { app: string; id: string },
): Promise<{ ok: true } | { error: string }> {
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
  }
  return { ok: true }
}

/**
 * The principal behind a management-API request. Either the superadmin token
 * (the static ADMIN_API_TOKEN — every app, every permission) or a scoped key
 * bound to one application with an explicit permission set.
 */
export type ApiPrincipal = {
  kind: "superadmin" | "key"
  /** The app a scoped key is bound to; null for superadmin (all apps). */
  applicationId: string | null
  keyId: string | null
  /** Can this principal perform `permission` against `app`? */
  can: (app: string, permission: AppPermission) => boolean
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/** Constant-time string compare (avoids leaking the admin token via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/**
 * Resolves the bearer token on `request` to an {@link ApiPrincipal}, or null if
 * absent/invalid/expired/revoked. The static ADMIN_API_TOKEN authenticates as
 * superadmin; anything else is hashed and looked up in `api_key`. A successful
 * scoped-key lookup bumps `lastUsedAt` (best effort).
 */
export async function authenticateApiKey(
  request: Request,
  ctx: BaseServiceContext,
): Promise<ApiPrincipal | null> {
  const token = extractBearer(request)
  if (!token) return null

  const superToken = ctx.getAppEnv("ADMIN_API_TOKEN")
  if (superToken && timingSafeEqual(token, superToken)) {
    return { kind: "superadmin", applicationId: null, keyId: null, can: () => true }
  }

  // Only opaque keys we issued are worth a DB round-trip.
  if (!token.startsWith(TOKEN_PREFIX)) return null

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

  const granted = sanitizePermissions(row.permissions ?? [])

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

  return {
    kind: "key",
    applicationId: row.applicationId,
    keyId: row.id,
    can: (app, permission) => app === row.applicationId && granted.includes(permission),
  }
}

/**
 * Management-API gate. Authenticates the bearer token and (optionally) requires
 * `permission` on `app`. Throws a JSON 401/403 Response on failure; returns the
 * principal otherwise. Superadmins pass everything.
 */
export async function requireApiPrincipal(
  request: Request,
  ctx: BaseServiceContext,
  required?: { app: string; permission: AppPermission },
): Promise<ApiPrincipal> {
  const principal = await authenticateApiKey(request, ctx)
  if (!principal) {
    throw Response.json({ error: "unauthorized" }, { status: 401 })
  }
  if (required && !principal.can(required.app, required.permission)) {
    throw Response.json({ error: "forbidden" }, { status: 403 })
  }
  return principal
}

/**
 * Gate for cross-app (global) management endpoints — only the superadmin token
 * may list every app/user/workspace. Scoped keys are app-bound and get 403.
 */
export async function requireSuperadminApi(
  request: Request,
  ctx: BaseServiceContext,
): Promise<ApiPrincipal> {
  const principal = await requireApiPrincipal(request, ctx)
  if (principal.kind !== "superadmin") {
    throw Response.json({ error: "forbidden" }, { status: 403 })
  }
  return principal
}
