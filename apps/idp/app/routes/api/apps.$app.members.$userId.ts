import type { Route } from "./+types/apps.$app.members.$userId"
import { requireApiCaller } from "~/lib/caller.server"
import { readJson } from "~/lib/api.server"
import { UpdateMemberInput } from "@willyim/idp/schemas"
import { removeAppMember, updateAppMember } from "~/lib/members.server"

/**
 * PATCH — update a member's role + permissions (member:manage).
 * DELETE — remove a member (member:manage).
 * Both the permission check and the last-admin guard live in members.server;
 * this route only authenticates.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { app, userId } = params

  if (request.method === "PATCH" || request.method === "PUT") {
    const caller = await requireApiCaller(request, context, context.services.auth)
    const body = await readJson(request, UpdateMemberInput)
    const res = await updateAppMember(context, caller, {
      app,
      userId,
      role: body.role,
      permissions: body.permissions,
    })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    return Response.json({ ok: true })
  }

  if (request.method === "DELETE") {
    const caller = await requireApiCaller(request, context, context.services.auth)
    const res = await removeAppMember(context, caller, { app, userId })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    return Response.json({ ok: true })
  }

  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "PATCH, DELETE" } },
  )
}
