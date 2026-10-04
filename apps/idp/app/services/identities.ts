import { declareService, fail, method } from "@willyim/kit"
import { and, asc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { catalogOf, getApplicationByApp } from "../lib/admin.server"
import { productPermissionsFor } from "../lib/claims.server"
import { normaliseProvider, performLink } from "../lib/identities.server"
import { io } from "./io"

/**
 * Linked identities — a user's ids on other systems (Slack, WhatsApp,
 * Telegram), pinned to their IdP user so every surface gets the same answer
 * to "who is this, and what may they do here?".
 *
 * Two halves with deliberately different gates:
 *
 *   link / list / unlink   superadmin only, at the IdP level. A link asserts
 *                          "this external account IS this person" with nothing
 *                          to prove it, so no app and no member may do it — an
 *                          app that could link identities could grant itself
 *                          anyone.
 *   resolve                in the app, `identity:resolve`. The hot path: an
 *                          app hears from a Slack id and asks. Answers with
 *                          the user AND their product permissions for THAT
 *                          app, computed exactly the way the claims hook does
 *                          at token mint.
 */
export const identities = declareService((ctx) => ({
  resolve: method(
    {
      summary: "Resolve an external id to the user, and their product permissions in this app",
      description:
        "A miss is data (`found: false`), and the common case in any shared channel. `permissions` are computed as the claims hook computes them at token mint, so a Slack message and a browser session from the same person carry the same grants. A linked user with no membership resolves as found with no permissions. Not audited: this is the hot path.",
      permission: "identity:resolve",
      hints: { readOnly: true },
      ...io("identities.resolve"),
    },
    async (input) => {
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
            eq(schema.linkedIdentity.provider, normaliseProvider(input.provider)),
            eq(schema.linkedIdentity.externalId, input.externalId.trim()),
          ),
        )
        .limit(1)
      if (!row) return { found: false as const }

      const catalog = catalogOf(await getApplicationByApp(ctx, ctx.app))
      return {
        found: true as const,
        userId: row.userId,
        email: row.email,
        name: row.name ?? null,
        permissions: await productPermissionsFor(ctx.db, row.userId, ctx.app, catalog),
      }
    },
  ),

  list: method(
    {
      summary: "List the external ids pinned to a user, oldest first",
      permission: "*",
      hints: { readOnly: true },
      ...io("identities.list"),
    },
    async ({ userId }) => {
      const rows = await ctx.db
        .select()
        .from(schema.linkedIdentity)
        .where(eq(schema.linkedIdentity.userId, userId))
        .orderBy(asc(schema.linkedIdentity.createdAt))
      return {
        identities: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          provider: r.provider,
          externalId: r.externalId,
          label: r.label ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      }
    },
  ),

  link: method(
    {
      summary: "Pin an external id (a Slack member id, a phone number) to a user",
      description:
        "`created: false` when the same pair was already this user's. 409 when it belongs to someone else: an identity is never silently re-pointed, unlink it first. 404 for an unknown user.",
      permission: "*",
      hints: { idempotent: true },
      ...io("identities.link"),
    },
    async (input) => {
      const res = await performLink(ctx, ctx.audit, input)
      if (!("error" in res)) return res
      if (res.error === "unknown_user") fail(404, `No user ${input.userId}.`)
      fail(409, `${normaliseProvider(input.provider)}:${input.externalId.trim()} is already linked to another user.`)
    },
  ),

  unlink: method(
    {
      summary: "Unpin an external id from a user (idempotent)",
      permission: "*",
      hints: { destructive: true, idempotent: true },
      ...io("identities.unlink"),
    },
    async ({ userId, id }) => {
      // Scoped to the user, so the id alone is not enough.
      const [row] = await ctx.db
        .select()
        .from(schema.linkedIdentity)
        .where(and(eq(schema.linkedIdentity.id, id), eq(schema.linkedIdentity.userId, userId)))
        .limit(1)
      if (row) {
        await ctx.db.delete(schema.linkedIdentity).where(eq(schema.linkedIdentity.id, row.id))
        await ctx.audit.record({
          table: "linked_identity",
          operation: "delete",
          rowId: row.id,
          before: { userId, provider: row.provider, externalId: row.externalId },
        })
      }
      return { ok: true as const }
    },
  ),
}))
