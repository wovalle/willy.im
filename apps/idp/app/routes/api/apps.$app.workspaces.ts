import type { Route } from "./+types/apps.$app.workspaces"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** GET — workspaces.list. */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, args.params.app, (ctx) => ctx.services.workspaces.list())
}

/** POST — workspaces.create. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.workspaces.create(body), 201)
}
