import type { Route } from "./+types/users.$userId.identities.$id"
import { methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { unlinkIdentity } from "~/lib/identities.server"
import { appContext } from "~/context"

/** DELETE — remove one link (idempotent). Superadmin only. */
export async function action({ request, context: router, params }: Route.ActionArgs) {
  const context = router.get(appContext)
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const res = await unlinkIdentity(context, caller, { userId: params.userId, id: params.id })
  return Response.json(res)
}
