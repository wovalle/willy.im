import type { Route } from "./+types/applications.$clientId"
import {
  deleteApplication,
  getApplication,
  updateApplication,
  type ApplicationSummary,
} from "~/lib/admin.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { UpdateApplicationInput } from "@willyim/idp/schemas"

/** The wire shape — `createdAt` as ISO, matching the list endpoint's items. */
function serialize(application: ApplicationSummary) {
  return { ...application, createdAt: application.createdAt.toISOString() }
}

/**
 * GET — one application. The permission is app-scoped, so the app key has to be
 * resolved from the client id before the caller can be judged; an unknown
 * client id is a 404 for everyone, authenticated or not.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const application = await getApplication(context, params.clientId)
  if (!application) {
    // Authenticate first, so an anonymous prober can't map client ids.
    await requireApiCaller(request, context, context.services.auth)
    return Response.json({ error: "not_found" }, { status: 404 })
  }
  await requireApiCaller(request, context, context.services.auth, {
    app: application.app ?? "",
    permission: "app:read",
  })
  return Response.json(serialize(application))
}

/** PATCH — update name / redirect URIs / signup. DELETE — deregister. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "PATCH" && request.method !== "DELETE")
    return methodNotAllowed(["PATCH", "DELETE"])

  // Authenticate only — the services own the app:update / app:delete checks.
  const caller = await requireApiCaller(request, context, context.services.auth)

  if (request.method === "DELETE") {
    const application = await getApplication(context, params.clientId)
    if (!application) return Response.json({ error: "not_found" }, { status: 404 })
    await deleteApplication(context, caller, params.clientId)
    return Response.json({ ok: true })
  }

  const body = await readJson(request, UpdateApplicationInput)
  const updated = await updateApplication(context, caller, params.clientId, body)
  if (updated === null) return Response.json({ error: "not_found" }, { status: 404 })
  if ("error" in updated)
    return Response.json({ error: updated.error, detail: updated.detail }, { status: 422 })
  return Response.json(serialize(updated))
}
