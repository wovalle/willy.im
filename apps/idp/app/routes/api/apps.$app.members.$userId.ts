import type { Route } from "./+types/apps.$app.members.$userId"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { readJson } from "~/lib/api.server"
import { UpdateMemberInput } from "~/lib/api-schemas"
import { actorFromPrincipal, recordAudit } from "~/lib/audit.server"
import { removeAppMember, updateAppMember } from "~/lib/members.server"

/**
 * PATCH — update a member's role + permissions (member:manage).
 * DELETE — remove a member (member:manage).
 * Both guard the last admin (handled in members.server).
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { app, userId } = params

  if (request.method === "PATCH" || request.method === "PUT") {
    const principal = await requireApiPrincipal(request, context, { app, permission: "member:manage" })
    const body = await readJson(request, UpdateMemberInput)
    const res = await updateAppMember(context, {
      app,
      userId,
      role: body.role,
      permissions: body.permissions,
    })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    await recordAudit(context, {
      actor: actorFromPrincipal(principal),
      table: "application_member",
      operation: "update",
      applicationId: app,
      rowId: userId,
      after: { role: body.role, permissions: body.permissions },
    })
    return Response.json({ ok: true })
  }

  if (request.method === "DELETE") {
    const principal = await requireApiPrincipal(request, context, { app, permission: "member:manage" })
    const res = await removeAppMember(context, { app, userId })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    await recordAudit(context, {
      actor: actorFromPrincipal(principal),
      table: "application_member",
      operation: "delete",
      applicationId: app,
      rowId: userId,
    })
    return Response.json({ ok: true })
  }

  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "PATCH, DELETE" } },
  )
}
