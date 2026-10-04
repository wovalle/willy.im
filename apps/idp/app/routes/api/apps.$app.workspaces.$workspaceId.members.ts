import type { Route } from "./+types/apps.$app.workspaces.$workspaceId.members"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** GET — workspace_members.list. */
export async function loader(args: Route.LoaderArgs) {
  const { app, workspaceId } = args.params
  return v1(args, app, (ctx) => ctx.services.workspace_members.list({ workspaceId }))
}

/** PUT — workspace_members.set. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "PUT") return methodNotAllowed(["GET", "PUT"])
  const { app, workspaceId } = args.params
  return v1(args, app, (ctx, body) => ctx.services.workspace_members.set({ ...body, workspaceId }))
}
