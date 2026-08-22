import type { Route } from "./+types/users.$userId.identities.$id"
import { methodNotAllowed } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { unlinkIdentity } from "~/lib/identities.server"

/** DELETE — remove one link (idempotent). Superadmin only. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const res = await unlinkIdentity(context, caller, { userId: params.userId, id: params.id })
  return Response.json(res)
}
