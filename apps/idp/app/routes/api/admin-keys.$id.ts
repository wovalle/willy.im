import type { Route } from "./+types/admin-keys.$id"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** DELETE — admin_keys.revoke (superadmin; a key may revoke itself). */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  return v1(args, null, (ctx) => ctx.services.admin_keys.revoke({ id: args.params.id }))
}
