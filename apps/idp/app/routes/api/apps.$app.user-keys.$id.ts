import type { Route } from "./+types/apps.$app.user-keys.$id"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { methodNotAllowed } from "~/lib/api.server"
import { actorFromPrincipal, recordAudit } from "~/lib/audit.server"
import { revokeUserApiKey } from "~/lib/user-api-keys.server"

/** DELETE — revoke an end-user API key (idempotent). Requires userkey:revoke. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const principal = await requireApiPrincipal(request, context, {
    app: params.app,
    permission: "userkey:revoke",
  })
  const res = await revokeUserApiKey(context, { app: params.app, id: params.id })
  if ("error" in res) return Response.json({ error: res.error }, { status: 404 })
  await recordAudit(context, {
    actor: actorFromPrincipal(principal),
    table: "user_api_key",
    operation: "revoke",
    applicationId: params.app,
    rowId: params.id,
  })
  return Response.json({ ok: true })
}
