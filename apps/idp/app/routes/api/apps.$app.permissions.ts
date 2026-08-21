import type { Route } from "./+types/apps.$app.permissions"
import { getApplicationByApp, updateApplicationPermissions } from "~/lib/admin.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { SetAppPermissionsInput } from "@willyim/idp/schemas"

/**
 * PUT — replace the app's product-permission catalog wholesale. This is the
 * vocabulary members can be granted and what's emitted in the permissions
 * claim, so a replace (not a merge) is the honest verb. Requires `app:update`.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "PUT") return methodNotAllowed(["PUT"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const application = await getApplicationByApp(context, params.app)
  if (!application) return Response.json({ error: "not_found" }, { status: 404 })
  const body = await readJson(request, SetAppPermissionsInput)
  const permissions = await updateApplicationPermissions(
    context,
    caller,
    application.clientId,
    body.permissions,
  )
  return Response.json({ permissions })
}
