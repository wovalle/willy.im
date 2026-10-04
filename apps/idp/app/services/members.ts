import { declareService, fail, method } from "@willyim/kit"
import { and, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { catalogOf, getApplicationByApp } from "../lib/admin.server"
import { normalizeEmail, resolveUserByEmail, sendInviteEmail } from "../lib/members.server"
import { isAppPermission, resolvePermissions, type AppRole } from "../lib/permissions"
import { isDeclared, requireScopes, type AppCatalog } from "../lib/scopes.server"
import { io } from "./io"

/**
 * Who may administer or use an app in the IdP: its members (an admin holds
 * the whole management catalog, a member an explicit subset, and either may
 * hold grants from the app's own product catalog) and the pending invitations
 * of people who have no willy.im account yet.
 *
 * Whoever hands out management permissions (inviting, changing a role) must
 * hold them first: `ctx.caller.require(...)` in the app, before any write.
 */

/** Invites stay valid for 7 days. */
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7

/** Admins resolve to the whole catalog, so nothing is stored for them. */
const managementGrants = (role: AppRole, permissions: string[]) =>
  role === "admin" ? [] : permissions.filter(isAppPermission)

/**
 * Product grants the app's catalog declares (a flat entry, or `<type>:<id>`
 * under a declared type). Whether an instance EXISTS was asked before the
 * write (`requireScopes`); this only guards the shape. Admins store none.
 */
const productGrants = (role: AppRole, grants: string[], catalog: AppCatalog) =>
  role === "admin" ? [] : [...new Set(grants)].filter((p) => isDeclared(p, catalog))

export const members = declareService((ctx) => {
  const memberWhere = (userId: string) =>
    and(
      eq(schema.applicationMember.applicationId, ctx.app),
      eq(schema.applicationMember.userId, userId),
    )

  const rows = () =>
    ctx.db
      .select({
        userId: schema.applicationMember.userId,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.applicationMember.role,
        permissions: schema.applicationMember.permissions,
        productPermissions: schema.applicationMember.productPermissions,
      })
      .from(schema.applicationMember)
      .innerJoin(schema.user, eq(schema.applicationMember.userId, schema.user.id))
      .where(eq(schema.applicationMember.applicationId, ctx.app))

  /** The last admin can be neither demoted nor removed. */
  const isLastAdmin = async (role: AppRole) =>
    role === "admin" &&
    (await rows()).filter((m) => m.role === "admin").length <= 1

  const catalog = async () => catalogOf(await getApplicationByApp(ctx, ctx.app))

  return {
    list: method(
      {
        summary: "List the app's members, with their management and product permissions",
        permission: "member:read",
        hints: { readOnly: true },
        ...io("members.list"),
      },
      async () => ({
        members: (await rows()).map((m) => ({
          ...m,
          permissions: m.permissions ?? [],
          productPermissions: m.productPermissions ?? [],
        })),
      }),
    ),

    invite: method(
      {
        summary: "Add an existing user to the app, or email an invitation to a new one",
        description:
          "An email that belongs to a willy.im user joins at once (`added`); any other gets a pending invitation and an accept link by email (`invited`), converted on their first sign-in. `permissions` are the IdP's management verbs and must all be held by the caller; `productPermissions` are grants from the app's own catalog, each checked against the catalog and, for `<type>:<id>`, against the app's live list (422 names a miss, 502 when the list could not be read). 409 when they are already a member.",
        permission: "member:invite",
        ...io("members.invite"),
      },
      async (input) => {
        // Nobody hands out more than they hold.
        ctx.caller.require(...resolvePermissions(input.role, input.permissions))
        const appCatalog = await catalog()
        const scopes = await requireScopes(input.productPermissions, ctx.app, appCatalog, ctx.resources)
        const email = normalizeEmail(input.email)
        const permissions = managementGrants(input.role, input.permissions)
        const productPermissions = productGrants(input.role, scopes, appCatalog)

        const existing = await resolveUserByEmail(ctx, email)
        if (existing) {
          const [already] = await ctx.db
            .select({ id: schema.applicationMember.id })
            .from(schema.applicationMember)
            .where(memberWhere(existing.id))
            .limit(1)
          if (already) fail(409, `${email} is already a member.`)
          await ctx.db.insert(schema.applicationMember).values({
            applicationId: ctx.app,
            userId: existing.id,
            role: input.role,
            permissions,
            productPermissions,
          })
          await ctx.audit.record({
            table: "application_member",
            operation: "invite",
            after: { email, role: input.role, permissions, result: "added" },
          })
          return { result: "added" as const }
        }

        // No account yet: upsert a pending invitation and (re)send the link.
        const token = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
        await ctx.db
          .insert(schema.applicationInvitation)
          .values({
            applicationId: ctx.app,
            email,
            role: input.role,
            permissions,
            productPermissions,
            token,
            // Null for a key: it has no user behind it.
            invitedByUserId: ctx.userId,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [schema.applicationInvitation.applicationId, schema.applicationInvitation.email],
            set: { role: input.role, permissions, productPermissions, token, expiresAt },
          })
        await sendInviteEmail(ctx, { origin: ctx.origin, email, token, app: ctx.app, role: input.role })
        await ctx.audit.record({
          table: "application_invitation",
          operation: "invite",
          after: { email, role: input.role, permissions, result: "invited" },
        })
        return { result: "invited" as const }
      },
    ),

    set_access: method(
      {
        summary: "Set a member's role, management permissions and product grants",
        description:
          "`productPermissions` REPLACES the member's grants (omit it to leave them alone): a merge could never take one away. Only grants the member doesn't already hold are checked against the app's live list, so a stale one never blocks an unrelated edit. The caller must hold every management permission the member ends up with. 409 for the last admin's demotion.",
        permission: "member:manage",
        hints: { idempotent: true },
        ...io("members.set_access"),
      },
      async (input) => {
        ctx.caller.require(...resolvePermissions(input.role, input.permissions))
        const [current] = await ctx.db
          .select({
            role: schema.applicationMember.role,
            productPermissions: schema.applicationMember.productPermissions,
          })
          .from(schema.applicationMember)
          .where(memberWhere(input.userId))
          .limit(1)
        if (!current) fail(404, "Member not found.")
        if (input.role !== "admin" && (await isLastAdmin(current.role)))
          fail(409, "Can't demote the last admin — promote someone else first.")

        const held = current.productPermissions ?? []
        const requested = input.productPermissions ?? held
        const appCatalog = await catalog()
        await requireScopes(
          requested.filter((s) => !held.includes(s)),
          ctx.app,
          appCatalog,
          ctx.resources,
        )
        const permissions = managementGrants(input.role, input.permissions)
        const productPermissions = productGrants(input.role, requested, appCatalog)
        await ctx.db
          .update(schema.applicationMember)
          .set({ role: input.role, permissions, productPermissions })
          .where(memberWhere(input.userId))
        await ctx.audit.record({
          table: "application_member",
          operation: "update",
          rowId: input.userId,
          after: { role: input.role, permissions, productPermissions },
        })
        return { ok: true as const }
      },
    ),

    remove: method(
      {
        summary: "Remove a member from the app (never the last admin)",
        permission: "member:manage",
        hints: { destructive: true },
        ...io("members.remove"),
      },
      async ({ userId }) => {
        const [current] = await ctx.db
          .select({ role: schema.applicationMember.role })
          .from(schema.applicationMember)
          .where(memberWhere(userId))
          .limit(1)
        if (!current) fail(404, "Member not found.")
        if (await isLastAdmin(current.role))
          fail(409, "Can't remove the last admin — promote someone else first.")
        await ctx.db.delete(schema.applicationMember).where(memberWhere(userId))
        await ctx.audit.record({ table: "application_member", operation: "delete", rowId: userId })
        return { ok: true as const }
      },
    ),
  }
})

export const invitations = declareService((ctx) => {
  const invitationWhere = (id: string) =>
    and(
      eq(schema.applicationInvitation.applicationId, ctx.app),
      eq(schema.applicationInvitation.id, id),
    )

  return {
    list: method(
      {
        summary: "List the app's pending invitations",
        permission: "member:read",
        hints: { readOnly: true },
        ...io("invitations.list"),
      },
      async () => {
        const rows = await ctx.db
          .select()
          .from(schema.applicationInvitation)
          .where(eq(schema.applicationInvitation.applicationId, ctx.app))
        return {
          invitations: rows.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            permissions: i.permissions ?? [],
            expiresAt: i.expiresAt.toISOString(),
            createdAt: i.createdAt.toISOString(),
          })),
        }
      },
    ),

    resend: method(
      {
        summary: "Re-send a pending invitation's link and give it another 7 days",
        permission: "member:invite",
        ...io("invitations.resend"),
      },
      async ({ id }) => {
        const [inv] = await ctx.db
          .select()
          .from(schema.applicationInvitation)
          .where(invitationWhere(id))
          .limit(1)
        if (!inv) fail(404, "Invitation not found.")
        await ctx.db
          .update(schema.applicationInvitation)
          .set({ expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
          .where(eq(schema.applicationInvitation.id, inv.id))
        await sendInviteEmail(ctx, {
          origin: ctx.origin,
          email: inv.email,
          token: inv.token,
          app: inv.applicationId,
          role: inv.role,
        })
        return { ok: true as const }
      },
    ),

    revoke: method(
      {
        summary: "Drop a pending invitation, so signing in grants nothing (idempotent)",
        permission: "member:invite",
        hints: { destructive: true, idempotent: true },
        ...io("invitations.revoke"),
      },
      async ({ id }) => {
        await ctx.db.delete(schema.applicationInvitation).where(invitationWhere(id))
        return { ok: true as const }
      },
    ),
  }
})
