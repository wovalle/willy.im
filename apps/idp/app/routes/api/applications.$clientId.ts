import type { Route } from "./+types/applications.$clientId"
import { methodNotAllowed } from "~/lib/api.server"
import { missing, tenantOf, v1 } from "~/lib/v1.server"

/** GET — applications.get. */
export async function loader(args: Route.LoaderArgs) {
  const app = await tenantOf(args)
  return v1(args, app, (ctx) => (app ? ctx.services.applications.get() : missing()))
}

/** PATCH — applications.update. DELETE — applications.delete. */
export async function action(args: Route.ActionArgs) {
  const app = await tenantOf(args)
  if (args.request.method === "PATCH")
    return v1(args, app, (ctx, body) => (app ? ctx.services.applications.update(body) : missing()))
  if (args.request.method === "DELETE")
    return v1(args, app, (ctx) => (app ? ctx.services.applications.delete() : missing()))
  return methodNotAllowed(["PATCH", "DELETE"])
}
