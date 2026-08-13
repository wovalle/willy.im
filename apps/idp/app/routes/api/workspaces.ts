import type { Route } from "./+types/workspaces"
import { listWorkspaces } from "~/lib/admin.server"
import { requireSuperadminApi } from "~/lib/api-keys.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireSuperadminApi(request, context)
  const workspaces = await listWorkspaces(context)
  return Response.json({
    workspaces: workspaces.map((w) => ({ ...w, createdAt: new Date(w.createdAt).toISOString() })),
  })
}
