import type { Route } from "./+types/apps.$app.workspaces.$workspaceId.members"
import { SetWorkspaceMemberInput } from "@willyim/idp/schemas"
import { readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { listWorkspaceMembers, setWorkspaceMember } from "~/lib/workspace-members.server"
import { appContext } from "~/context"

const status = { unknown_workspace: 404, unknown_user: 404, not_a_member: 404 } as const

/** GET — a workspace's members and roles (member:read). */
export async function loader({ request, context: router, params }: Route.LoaderArgs) {
  const context = router.get(appContext)
  const caller = await requireApiCaller(request, context, context.services.auth)
  const res = await listWorkspaceMembers(context, caller, params)
  if ("error" in res) return Response.json(res, { status: status[res.error] })
  return Response.json(res)
}

/** PUT — put an existing user in the workspace with a role, or change it (member:manage). */
export async function action({ request, context: router, params }: Route.ActionArgs) {
  const context = router.get(appContext)
  if (request.method !== "PUT") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET, PUT" } })
  }
  // Authenticate only — workspace-members.server owns the member:manage check.
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, SetWorkspaceMemberInput)
  const res = await setWorkspaceMember(context, caller, { ...params, ...body })
  if ("error" in res) return Response.json(res, { status: status[res.error] })
  return Response.json(res)
}
