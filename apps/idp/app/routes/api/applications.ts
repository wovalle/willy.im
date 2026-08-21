import type { Route } from "./+types/applications"
import { createApplication, listApplications } from "~/lib/admin.server"
import { readJson, methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { CreateApplicationInput } from "@willyim/idp/schemas"

/** GET — every registered application. Superadmin only (cross-app read). */
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, { superadmin: true })
  const applications = await listApplications(context)
  return Response.json({
    applications: applications.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  })
}

/**
 * POST — register an application. The client secret comes back once and is not
 * recoverable. Authenticate only; createApplication owns the superadmin check.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, CreateApplicationInput)
  const created = await createApplication(context, caller, {
    name: body.name,
    app: body.app,
    redirectUris: body.redirectUris,
    // Only forward when present: `undefined` means "the calling user", which is
    // a different thing from an explicit `null` ("no members at all").
    ...(body.firstAdminUserId !== undefined ? { firstAdminUserId: body.firstAdminUserId } : {}),
  })
  if ("error" in created) {
    if (created.error === "app_taken") return Response.json({ error: "app_taken" }, { status: 409 })
    return Response.json({ error: created.error, detail: created.detail }, { status: 422 })
  }
  return Response.json(created, { status: 201 })
}
