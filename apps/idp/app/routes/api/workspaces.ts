import type { Route } from "./+types/workspaces"
import { listWorkspaces } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"
import { appContext } from "~/context"

export async function loader({ request, context: router }: Route.LoaderArgs) {
  const context = router.get(appContext)
  await requireApiCaller(request, context, context.services.auth, { superadmin: true })
  const workspaces = await listWorkspaces(context)
  return Response.json({
    workspaces: workspaces.map((w) => ({ ...w, createdAt: new Date(w.createdAt).toISOString() })),
  })
}
