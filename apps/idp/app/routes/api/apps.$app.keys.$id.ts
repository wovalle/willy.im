import type { Route } from "./+types/apps.$app.keys.$id"
import { revokeApiKey } from "~/lib/api-keys.server"
import { methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"

/** DELETE — revoke a scoped management key (idempotent). Requires `apikey:revoke`. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const res = await revokeApiKey(context, caller, { app: params.app, id: params.id })
  if ("error" in res) return Response.json({ error: "not_found" }, { status: 404 })
  return Response.json({ ok: true })
}
