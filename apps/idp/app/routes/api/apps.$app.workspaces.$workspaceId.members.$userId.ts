import type { Route } from "./+types/apps.$app.workspaces.$workspaceId.members.$userId"
import { requireApiCaller } from "~/lib/caller.server"
import { removeWorkspaceMember } from "~/lib/workspace-members.server"
import { appContext } from "~/context"

/** DELETE — remove someone from a workspace (member:manage). */
export async function action({ request, context: router, params }: Route.ActionArgs) {
  const context = router.get(appContext)
  if (request.method !== "DELETE") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "DELETE" } })
  }
  const caller = await requireApiCaller(request, context, context.services.auth)
  const res = await removeWorkspaceMember(context, caller, params)
  if ("error" in res) return Response.json(res, { status: 404 })
  return Response.json(res)
}
