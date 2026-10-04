import { and, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { auditTrail } from "./audit.server"
import type { BaseServiceContext } from "./services"

/**
 * Pinning an external id (a Slack member id, a Discord snowflake) to an IdP
 * user. Two doors reach it: `identities.link` (services/identities.ts), where
 * a superadmin ASSERTS the link, and {@link linkVerifiedIdentity}, where the
 * user PROVED it through the provider's OAuth round trip.
 */

/** Lowercase, trimmed. "Slack" and "slack" are the same system. */
export function normaliseProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

export type LinkOutcome =
  | { id: string; created: boolean }
  | { error: "unknown_user" }
  | { error: "already_linked"; toUserId: string }

type Audit = ReturnType<typeof auditTrail>

/**
 * The shared body: the uniqueness rules and the audit entry, in one place. The
 * (provider, externalId) pair is unique: linking one that already belongs to
 * SOMEONE ELSE is refused rather than moved, because silently re-pointing an
 * identity is how one person starts receiving another's grants. Re-linking to
 * the same user is idempotent.
 */
export async function performLink(
  ctx: BaseServiceContext,
  audit: Audit,
  input: { userId: string; provider: string; externalId: string; label?: string | null },
): Promise<LinkOutcome> {
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
  // Global to the user, not to any app: the IdP-level audit scope.
  await audit.record({
    table: "linked_identity",
    operation: "create",
    rowId: id,
    after: { userId: input.userId, provider, externalId },
  })
  return { id, created: true }
}

/**
 * A link the USER proved, rather than one a superadmin asserted.
 *
 * The superadmin gate on `identities.link` exists because a link asserts
 * identity with nothing to prove it. An OAuth round trip through the provider
 * IS that proof: Discord told us, on a channel the user authenticated on, which
 * snowflake belongs to the account that just consented. So this path skips the
 * gate — and ONLY this path may, which is why it is a named function rather
 * than a flag on the method. Its caller is the `account.create` hook in
 * auth.server.ts and nothing else.
 *
 * Every other rule is unchanged, deliberately: an external id already pinned to
 * SOMEONE ELSE is still refused rather than moved. Proving you control a Discord
 * account does not entitle you to take it off the person it is already pinned
 * to — that is an admin's call, with the audit entry to match.
 */
export async function linkVerifiedIdentity(
  ctx: BaseServiceContext,
  input: { userId: string; provider: string; externalId: string; label?: string | null },
): Promise<LinkOutcome> {
  return performLink(ctx, auditTrail(ctx, { id: `user:${input.userId}` }, null), input)
}
