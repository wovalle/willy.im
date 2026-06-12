import type { Route } from "./+types/apps.$app.workspaces"
import { createWorkspaceForApp, listWorkspacesForApp } from "~/lib/admin.server"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { readJson } from "~/lib/api.server"
import { CreateWorkspaceInput } from "~/lib/api-schemas"
import { actorFromPrincipal, recordAudit } from "~/lib/audit.server"

/** GET — list this app's workspaces. Requires workspace:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiPrincipal(request, context, { app: params.app, permission: "workspace:read" })
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
  const principal = await requireApiPrincipal(request, context, {
    app: params.app,
    permission: "workspace:create",
  })
  const body = await readJson(request, CreateWorkspaceInput)
  const res = await createWorkspaceForApp(context, {
    app: params.app,
    name: body.name,
    slug: body.slug,
    domain: body.domain ?? null,
  })
  if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
  await recordAudit(context, {
    actor: actorFromPrincipal(principal),
    table: "organization",
    operation: "create",
    applicationId: params.app,
    rowId: res.id,
    after: { name: res.name, slug: res.slug },
  })
  return Response.json(res, { status: 201 })
}
