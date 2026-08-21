import type { Route } from "./+types/apps.$app.workspaces"
import { createWorkspaceForApp, listWorkspacesForApp } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"
import { readJson } from "~/lib/api.server"
import { CreateWorkspaceInput } from "@willyim/idp/schemas"

/** GET — list this app's workspaces. Requires workspace:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, {
    app: params.app,
    permission: "workspace:read",
  })
  const workspaces = await listWorkspacesForApp(context, params.app)
  return Response.json({
    workspaces: workspaces.map((w) => ({
      ...w,
      createdAt: new Date(w.createdAt as unknown as string).toISOString(),
    })),
  })
}

/** POST — create a workspace (tenant) in this app. Requires workspace:create. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } })
  }
  // Authenticate only — createWorkspaceForApp owns the workspace:create check,
  // so the API and the console can't authorize it differently.
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, CreateWorkspaceInput)
  const res = await createWorkspaceForApp(context, caller, {
    app: params.app,
    name: body.name,
    slug: body.slug,
  })
  if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
  return Response.json(res, { status: 201 })
}
