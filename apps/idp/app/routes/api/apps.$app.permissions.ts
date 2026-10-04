import type { Route } from "./+types/apps.$app.permissions"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** PUT — catalog.declare: replace the app's product-permission catalog wholesale. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "PUT") return methodNotAllowed(["PUT"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.catalog.declare(body))
}
