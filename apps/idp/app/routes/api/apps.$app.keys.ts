import type { Route } from "./+types/apps.$app.keys"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** GET — management_keys.list. */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, args.params.app, (ctx) => ctx.services.management_keys.list())
}

/** POST — management_keys.mint. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.management_keys.mint(body), 201)
}
