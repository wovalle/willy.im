import { and, asc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { getApplicationByApp } from "./admin.server"
import { IDP_AUDIT_SCOPE, recordAudit } from "./audit.server"
import { assertCan, type Caller } from "./caller.server"
import { productPermissionsFor } from "./claims.server"
import type { BaseServiceContext } from "./services"

/**
 * Linked identities — a user's ids on other systems (Slack, WhatsApp,
 * Telegram), pinned to their IdP user so every surface gets the same answer
 * to "who is this, and what may they do here?".
 *
 * Two halves with deliberately different gates:
 *
 *   link / list / unlink   superadmin only. A link asserts "this external
 *                          account IS this person" with nothing to prove it,
 *                          so no app and no member may do it — an app that
 *                          could link identities could grant itself anyone.
 *   resolve                app-scoped, `identity:resolve`. The hot path: an
 *                          app hears from a Slack id and asks. Answers with
 *                          the user AND their product permissions for THAT
 *                          app, computed exactly the way the claims hook
 *                          computes them at token mint — so a Slack message
 *                          and a browser session from the same person carry
 *                          the same grants.
 */

export type LinkedIdentitySummary = {
  id: string
  userId: string
  provider: string
  externalId: string
  label: string | null
  createdAt: Date
}

/** Lowercase, trimmed. "Slack" and "slack" are the same system. */
function normaliseProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

function summarise(row: schema.LinkedIdentity): LinkedIdentitySummary {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    externalId: row.externalId,
    label: row.label ?? null,
    createdAt: row.createdAt,
  }
}

function requireSuperadmin(caller: Caller) {
  if (caller.kind !== "superadmin") {
    throw Response.json({ error: "forbidden" }, { status: 403 })
  }
}

/** Every identity pinned to one user, oldest first. Superadmin only. */
export async function listLinkedIdentities(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { userId: string },
): Promise<LinkedIdentitySummary[]> {
  requireSuperadmin(caller)
  const rows = await ctx.db
    .select()
    .from(schema.linkedIdentity)
    .where(eq(schema.linkedIdentity.userId, input.userId))
    .orderBy(asc(schema.linkedIdentity.createdAt))
  return rows.map(summarise)
}

/**
 * Pins an external id to a user. The (provider, externalId) pair is unique:
 * linking one that already belongs to SOMEONE ELSE is refused rather than
 * moved, because silently re-pointing an identity is how one person starts
 * receiving another's grants. Re-linking to the same user is idempotent.
 *
 * Superadmin only.
 */
export async function linkIdentity(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { userId: string; provider: string; externalId: string; label?: string | null },
): Promise<
  | { id: string; created: boolean }
  | { error: "unknown_user" }
  | { error: "already_linked"; toUserId: string }
> {
  requireSuperadmin(caller)
  const provider = normaliseProvider(input.provider)
  const externalId = input.externalId.trim()

  const [u] = await ctx.db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .limit(1)
  if (!u) return { error: "unknown_user" }

  const [existing] = await ctx.db
    .select({ id: schema.linkedIdentity.id, userId: schema.linkedIdentity.userId })
    .from(schema.linkedIdentity)
    .where(
      and(
        eq(schema.linkedIdentity.provider, provider),
        eq(schema.linkedIdentity.externalId, externalId),
      ),
    )
    .limit(1)
  if (existing) {
    if (existing.userId === input.userId) return { id: existing.id, created: false }
    return { error: "already_linked", toUserId: existing.userId }
  }

  const id = crypto.randomUUID()
  await ctx.db.insert(schema.linkedIdentity).values({
    id,
    userId: input.userId,
    provider,
    externalId,
    label: input.label?.trim() || null,
  })

  await recordAudit(ctx, {
    actor: caller.actor,
    table: "linked_identity",
    operation: "create",
    // Global to the user, not to any app — same scope the admin keys use.
    applicationId: IDP_AUDIT_SCOPE,
    rowId: id,
    after: { userId: input.userId, provider, externalId },
  })

  return { id, created: true }
}

/** Removes one link (idempotent). Scoped to the user so the id alone is not enough. Superadmin only. */
export async function unlinkIdentity(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { userId: string; id: string },
): Promise<{ ok: true }> {
  requireSuperadmin(caller)
  const [row] = await ctx.db
    .select({ id: schema.linkedIdentity.id, provider: schema.linkedIdentity.provider, externalId: schema.linkedIdentity.externalId })
    .from(schema.linkedIdentity)
    .where(and(eq(schema.linkedIdentity.id, input.id), eq(schema.linkedIdentity.userId, input.userId)))
    .limit(1)
  if (row) {
    await ctx.db.delete(schema.linkedIdentity).where(eq(schema.linkedIdentity.id, row.id))
    await recordAudit(ctx, {
      actor: caller.actor,
      table: "linked_identity",
      operation: "delete",
      applicationId: IDP_AUDIT_SCOPE,
      rowId: row.id,
      before: { userId: input.userId, provider: row.provider, externalId: row.externalId },
    })
  }
  return { ok: true }
}

export type IdentityResolution =
  | {
      found: true
      userId: string
      email: string
      name: string | null
      /** This user's product permissions for the asking app — admins get the whole catalog. */
      permissions: string[]
    }
  | { found: false }

/**
 * "Who is <provider>:<externalId>, and what may they do in <app>?"
 *
 * The permissions are computed by the same function the claims hook uses at
 * token mint, against the app's current catalog, so the answer cannot drift
 * from what a browser session for the same person would carry. A user with no
 * membership in the app resolves as found with NO permissions — they exist,
 * the app just has not granted them anything — which is the correct signal
 * for "store the message, do not answer it".
 *
 * Requires `identity:resolve` on the app. Not audited: this is the hot read
 * path (every inbound chat message), and a row per call would drown the trail
 * the link/unlink writes share.
 */
export async function resolveIdentity(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; provider: string; externalId: string },
): Promise<IdentityResolution> {
  await assertCan(caller, input.app, "identity:resolve")
  const provider = normaliseProvider(input.provider)
  const externalId = input.externalId.trim()

  const [row] = await ctx.db
    .select({
      userId: schema.linkedIdentity.userId,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.linkedIdentity)
    .innerJoin(schema.user, eq(schema.linkedIdentity.userId, schema.user.id))
    .where(
      and(
        eq(schema.linkedIdentity.provider, provider),
        eq(schema.linkedIdentity.externalId, externalId),
      ),
    )
    .limit(1)
  if (!row) return { found: false }

  const application = await getApplicationByApp(ctx, input.app)
  const permissions = await productPermissionsFor(
    ctx.db,
    row.userId,
    input.app,
    application?.permissions ?? [],
  )

  return {
    found: true,
    userId: row.userId,
    email: row.email,
    name: row.name ?? null,
    permissions,
  }
}
