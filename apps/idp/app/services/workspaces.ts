import { declareService, fail, method } from "@willyim/kit"
import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { resolveUserByEmail } from "../lib/members.server"
import { io } from "./io"

/**
 * Workspaces: the collaboration boundaries inside an app (Better Auth
 * organizations tagged with the app key), and who belongs to each, as what.
 * A workspace membership is what the workspaces claim carries
 * (`claims.server.ts` `workspaceClaimsFor`), so apps that take their tenants
 * from the IdP see a person in a workspace only once a row exists here.
 */

type WorkspaceRow = {
  id: string
  name: string
  slug: string
  applicationId: string | null
  createdAt: Date
}

const toWorkspace = (w: WorkspaceRow) => ({ ...w, createdAt: w.createdAt.toISOString() })

const workspaceColumns = {
  id: schema.organization.id,
  name: schema.organization.name,
  slug: schema.organization.slug,
  applicationId: schema.organization.applicationId,
  createdAt: schema.organization.createdAt,
}

export const workspaces = declareService((ctx) => ({
  list: method(
    {
      summary: "List the app's workspaces, newest first",
      permission: "workspace:read",
      hints: { readOnly: true },
      ...io("workspaces.list"),
    },
    async () => {
      const rows = await ctx.db
        .select(workspaceColumns)
        .from(schema.organization)
        .where(eq(schema.organization.applicationId, ctx.app))
        .orderBy(desc(schema.organization.createdAt))
      return { workspaces: rows.map(toWorkspace) }
    },
  ),

  create: method(
    {
      summary: "Create a workspace in the app",
      description:
        "The slug is unique across every app (409 when taken). Nobody is in it yet: add people with `workspace_members.set`.",
      permission: "workspace:create",
      ...io("workspaces.create"),
    },
    async (input) => {
      // Inserted directly: Better Auth's createOrganization needs a session (it
      // makes the caller the owner), and a key has none.
      const slug = input.slug.trim().toLowerCase()
      const name = input.name.trim()
      const [clash] = await ctx.db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.slug, slug))
        .limit(1)
      if (clash) fail(409, `Slug "${slug}" is already taken.`)

      const id = crypto.randomUUID()
      await ctx.db
        .insert(schema.organization)
        .values({ id, name, slug, applicationId: ctx.app, createdAt: new Date() })
      await ctx.audit.record({
        table: "organization",
        operation: "create",
        rowId: id,
        after: { name, slug },
      })
      return { id, name, slug }
    },
  ),

  people: method(
    {
      summary: "List everyone in the app's workspaces, with the workspace and their role there",
      permission: "workspace:read",
      hints: { readOnly: true },
      ...io("workspaces.people"),
    },
    async () => ({
      people: await ctx.db
        .select({
          email: schema.user.email,
          name: schema.user.name,
          workspace: schema.organization.slug,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(
          schema.organization,
          and(
            eq(schema.member.organizationId, schema.organization.id),
            eq(schema.organization.applicationId, ctx.app),
          ),
        )
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id)),
    }),
  ),

  list_all: method(
    {
      summary: "List every workspace of every app, newest first",
      permission: "*",
      hints: { readOnly: true },
      ...io("workspaces.list_all"),
    },
    async () => {
      const rows = await ctx.db
        .select(workspaceColumns)
        .from(schema.organization)
        .orderBy(desc(schema.organization.createdAt))
      return { workspaces: rows.map(toWorkspace) }
    },
  ),
}))

export const workspace_members = declareService((ctx) => {
  /** The workspace if it belongs to this app; another app's is as missing as none. */
  const workspaceOf = async (workspaceId: string) => {
    const [row] = await ctx.db
      .select({ id: schema.organization.id, slug: schema.organization.slug })
      .from(schema.organization)
      .where(
        and(
          eq(schema.organization.id, workspaceId),
          eq(schema.organization.applicationId, ctx.app),
        ),
      )
      .limit(1)
    return row ?? fail(404, `No such workspace in ${ctx.app}.`)
  }

  return {
    list: method(
      {
        summary: "List a workspace's members and their roles",
        permission: "workspace:read",
        hints: { readOnly: true },
        ...io("workspace_members.list"),
      },
      async ({ workspaceId }) => {
        await workspaceOf(workspaceId)
        const members = await ctx.db
          .select({
            userId: schema.member.userId,
            email: schema.user.email,
            name: schema.user.name,
            role: schema.member.role,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(eq(schema.member.organizationId, workspaceId))
        return { members }
      },
    ),

    set: method(
      {
        summary: "Put an existing user in a workspace with a role, or change their role there",
        description:
          "The user must already exist at the IdP (404 otherwise: invite them to the app first with `members.invite`). Idempotent: the same call twice leaves one membership.",
        permission: "member:manage",
        hints: { idempotent: true },
        ...io("workspace_members.set"),
      },
      async ({ workspaceId, email, role }) => {
        const workspace = await workspaceOf(workspaceId)
        const user = await resolveUserByEmail(ctx, email)
        if (!user) fail(404, `No IdP user with that email. Invite them to ${ctx.app} first (members.invite).`)

        const [existing] = await ctx.db
          .select({ id: schema.member.id, role: schema.member.role })
          .from(schema.member)
          .where(and(eq(schema.member.organizationId, workspace.id), eq(schema.member.userId, user.id)))
          .limit(1)
        if (!existing) {
          const id = crypto.randomUUID()
          await ctx.db.insert(schema.member).values({
            id,
            organizationId: workspace.id,
            userId: user.id,
            role,
            createdAt: new Date(),
          })
          await ctx.audit.record({
            table: "member",
            operation: "create",
            rowId: id,
            after: { workspace: workspace.slug, userId: user.id, role },
          })
        } else if (existing.role !== role) {
          await ctx.db.update(schema.member).set({ role }).where(eq(schema.member.id, existing.id))
          await ctx.audit.record({
            table: "member",
            operation: "update",
            rowId: existing.id,
            before: { role: existing.role },
            after: { role },
          })
        }

        const [person] = await ctx.db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, user.id))
          .limit(1)
        return { userId: user.id, email: user.email, name: person?.name ?? null, role }
      },
    ),

    remove: method(
      {
        summary: "Take someone out of a workspace",
        permission: "member:manage",
        hints: { destructive: true },
        ...io("workspace_members.remove"),
      },
      async ({ workspaceId, userId }) => {
        const workspace = await workspaceOf(workspaceId)
        const [row] = await ctx.db
          .delete(schema.member)
          .where(and(eq(schema.member.organizationId, workspace.id), eq(schema.member.userId, userId)))
          .returning({ id: schema.member.id, role: schema.member.role })
        if (!row) fail(404, "They aren't in this workspace.")
        await ctx.audit.record({
          table: "member",
          operation: "delete",
          rowId: row.id,
          before: { workspace: workspace.slug, userId, role: row.role },
        })
        return { ok: true as const }
      },
    ),
  }
})
