import type { Route } from "./+types/applications"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** GET — applications.list (superadmin). */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, null, (ctx) => ctx.services.applications.list())
}

/** POST — applications.register (superadmin): the client secret comes back once. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, null, (ctx, body) => ctx.services.applications.register(body), 201)
}
