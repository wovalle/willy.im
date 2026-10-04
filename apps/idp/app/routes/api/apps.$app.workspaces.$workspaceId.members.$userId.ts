import type { Route } from "./+types/apps.$app.workspaces.$workspaceId.members.$userId"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** DELETE — workspace_members.remove. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const { app, workspaceId, userId } = args.params
  return v1(args, app, (ctx) => ctx.services.workspace_members.remove({ workspaceId, userId }))
}
