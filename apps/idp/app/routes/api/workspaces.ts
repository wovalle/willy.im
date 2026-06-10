import type { Route } from "./+types/workspaces"
import { listWorkspaces, requireAdminToken } from "~/lib/admin.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  requireAdminToken(request, context)
  const workspaces = await listWorkspaces(context)
  return Response.json({
    workspaces: workspaces.map((w) => ({ ...w, createdAt: new Date(w.createdAt).toISOString() })),
  })
}
