import type { Route } from "./+types/apps.$app.tokens"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** POST — app_tokens.mint (superadmin). */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.app_tokens.mint(body), 201)
}
