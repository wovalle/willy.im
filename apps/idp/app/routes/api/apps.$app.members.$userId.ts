import type { Route } from "./+types/apps.$app.members.$userId"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** PATCH (or PUT) — members.set_access. DELETE — members.remove. */
export async function action(args: Route.ActionArgs) {
  const { app, userId } = args.params
  if (args.request.method === "PATCH" || args.request.method === "PUT")
    return v1(args, app, (ctx, body) => ctx.services.members.set_access({ ...body, userId }))
  if (args.request.method === "DELETE")
    return v1(args, app, (ctx) => ctx.services.members.remove({ userId }))
  return methodNotAllowed(["PATCH", "DELETE"])
}
