import type { Route } from "./+types/applications.$clientId.rotate-secret"
import { getApplication, rotateApplicationSecret } from "~/lib/admin.server"
import { methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"

/**
 * POST — mint a new client secret. The previous one stops working immediately
 * and the new plaintext is returned exactly once. Requires `app:update`
 * (enforced by the service).
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const application = await getApplication(context, params.clientId)
  if (!application) return Response.json({ error: "not_found" }, { status: 404 })
  const { clientSecret } = await rotateApplicationSecret(context, caller, params.clientId)
  return Response.json({ clientSecret })
}
