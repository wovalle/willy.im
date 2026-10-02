import { and, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { recordAudit } from "./audit.server"
import { assertCan, type Caller } from "./caller.server"
import { resolveUserByEmail } from "./members.server"
import type { BaseServiceContext } from "./services"

/**
 * Who belongs to a workspace, and as what. A membership is a `member` row
 * (organization ↔ user, with a role); it is what the workspaces claim carries
 * (`claims.server.ts` `workspaceClaimsFor`), so apps that take their tenants
 * from the IdP see a person in a workspace only once a row exists here.
 *
 * Reads need `member:read` on the workspace's app; writes `member:manage`.
 */

type Failure = { error: "unknown_workspace" | "unknown_user" | "not_a_member"; message: string }

/** The workspace `workspaceId` if it belongs to `app`, else null: another app's workspace is invisible. */
async function workspaceOf(ctx: BaseServiceContext, app: string, workspaceId: string) {
  const [row] = await ctx.db
    .select({ id: schema.organization.id, slug: schema.organization.slug })
    .from(schema.organization)
    .where(and(eq(schema.organization.id, workspaceId), eq(schema.organization.applicationId, app)))
    .limit(1)
  return row ?? null
}

const noWorkspace = (app: string): Failure => ({
  error: "unknown_workspace",
  message: `No such workspace in ${app}.`,
})

export async function listWorkspaceMembers(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; workspaceId: string },
) {
  await assertCan(caller, input.app, "member:read")
  if (!(await workspaceOf(ctx, input.app, input.workspaceId))) return noWorkspace(input.app)
  const members = await ctx.db
    .select({
      userId: schema.member.userId,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, input.workspaceId))
  return { members }
}

/** Puts an existing user in the workspace with `role`, or changes their role. Idempotent. */
export async function setWorkspaceMember(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; workspaceId: string; email: string; role: "owner" | "admin" | "member" },
) {
  await assertCan(caller, input.app, "member:manage")
  const workspace = await workspaceOf(ctx, input.app, input.workspaceId)
  if (!workspace) return noWorkspace(input.app)
  const user = await resolveUserByEmail(ctx, input.email)
  if (!user) {
    return {
      error: "unknown_user",
      message: `No IdP user with that email. Invite them to ${input.app} first (POST /api/v1/apps/${input.app}/members).`,
    } satisfies Failure
  }

  const [existing] = await ctx.db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, workspace.id), eq(schema.member.userId, user.id)))
    .limit(1)

  if (existing) {
    if (existing.role !== input.role) {
      await ctx.db.update(schema.member).set({ role: input.role }).where(eq(schema.member.id, existing.id))
      await recordAudit(ctx, {
        actor: caller.actor,
        table: "member",
        operation: "update",
        applicationId: input.app,
        rowId: existing.id,
        before: { role: existing.role },
        after: { role: input.role },
      })
    }
  } else {
    const id = crypto.randomUUID()
    await ctx.db.insert(schema.member).values({
      id,
      organizationId: workspace.id,
      userId: user.id,
      role: input.role,
      createdAt: new Date(),
    })
    await recordAudit(ctx, {
      actor: caller.actor,
      table: "member",
      operation: "create",
      applicationId: input.app,
      rowId: id,
      after: { workspace: workspace.slug, userId: user.id, role: input.role },
    })
  }

  const [person] = await ctx.db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, user.id))
    .limit(1)
  return { userId: user.id, email: user.email, name: person?.name ?? null, role: input.role }
}

export async function removeWorkspaceMember(
  ctx: BaseServiceContext,
  caller: Caller,
  input: { app: string; workspaceId: string; userId: string },
) {
  await assertCan(caller, input.app, "member:manage")
  const workspace = await workspaceOf(ctx, input.app, input.workspaceId)
  if (!workspace) return noWorkspace(input.app)
  const [row] = await ctx.db
    .delete(schema.member)
    .where(and(eq(schema.member.organizationId, workspace.id), eq(schema.member.userId, input.userId)))
    .returning({ id: schema.member.id, role: schema.member.role })
  if (!row) return { error: "not_a_member", message: "They aren't in this workspace." } satisfies Failure
  await recordAudit(ctx, {
    actor: caller.actor,
    table: "member",
    operation: "delete",
    applicationId: input.app,
    rowId: row.id,
    before: { workspace: workspace.slug, userId: input.userId, role: row.role },
  })
  return { ok: true as const }
}
