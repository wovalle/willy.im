import type { Route } from "./+types/apps.$app.user-keys.validate"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** POST — user_keys.validate: always 200 with a `valid` discriminator (a miss is data). */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.user_keys.validate(body))
}
