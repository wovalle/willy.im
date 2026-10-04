import type { Route } from "./+types/users.$userId.identities.$id"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** DELETE — identities.unlink (superadmin; idempotent). */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  const { userId, id } = args.params
  return v1(args, null, (ctx) => ctx.services.identities.unlink({ userId, id }))
}
