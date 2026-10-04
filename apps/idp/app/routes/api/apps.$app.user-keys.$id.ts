import type { Route } from "./+types/apps.$app.user-keys.$id"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** DELETE — user_keys.revoke. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  return v1(args, args.params.app, (ctx) => ctx.services.user_keys.revoke({ id: args.params.id }))
}
