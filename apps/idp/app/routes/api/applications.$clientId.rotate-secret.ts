import type { Route } from "./+types/applications.$clientId.rotate-secret"
import { methodNotAllowed, missing, tenantOf, v1 } from "~/lib/v1.server"

/** POST — applications.rotate_secret: the new secret comes back once. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  const app = await tenantOf(args)
  return v1(args, app, (ctx) => (app ? ctx.services.applications.rotate_secret() : missing()))
}
