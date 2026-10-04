import type { Route } from "./+types/admin-keys"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** GET — admin_keys.list (superadmin). */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, null, (ctx) => ctx.services.admin_keys.list())
}

/** POST — admin_keys.mint (superadmin). */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["GET", "POST"])
  return v1(args, null, (ctx, body) => ctx.services.admin_keys.mint(body), 201)
}
