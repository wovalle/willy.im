import type { Route } from "./+types/workspaces"
import { listWorkspaces } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, { superadmin: true })
  const workspaces = await listWorkspaces(context)
  return Response.json({
    workspaces: workspaces.map((w) => ({ ...w, createdAt: new Date(w.createdAt).toISOString() })),
  })
}
