import type { Route } from "./+types/apps.$app.user-keys.$id"
import { requireApiCaller } from "~/lib/caller.server"
import { methodNotAllowed } from "~/lib/api.server"
import { revokeUserApiKey } from "~/lib/user-api-keys.server"

/** DELETE — revoke an end-user API key (idempotent). Requires userkey:revoke. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const res = await revokeUserApiKey(context, caller, { app: params.app, id: params.id })
  if ("error" in res) return Response.json({ error: res.error }, { status: 404 })
  return Response.json({ ok: true })
}
