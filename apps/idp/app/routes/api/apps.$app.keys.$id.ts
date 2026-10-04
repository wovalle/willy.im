import type { Route } from "./+types/apps.$app.keys.$id"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** DELETE — management_keys.revoke. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return methodNotAllowed(["DELETE"])
  return v1(args, args.params.app, (ctx) => ctx.services.management_keys.revoke({ id: args.params.id }))
}
