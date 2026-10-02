import type { Route } from "./+types/admin-keys.$id"
import { revokeAdminKey } from "~/lib/api-keys.server"
import { methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { appContext } from "~/context"

/**
 * DELETE — revoke an admin key (idempotent). Superadmin only. A key revoking
 * itself is allowed; its very next request then 401s.
 */
export async function action({ request, context: router, params }: Route.ActionArgs) {
  const context = router.get(appContext)
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const res = await revokeAdminKey(context, caller, params.id)
  if ("error" in res) return Response.json({ error: "not_found" }, { status: 404 })
  return Response.json({ ok: true })
}
