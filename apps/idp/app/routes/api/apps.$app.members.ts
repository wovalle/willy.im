import type { Route } from "./+types/apps.$app.members"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** GET — members.list. */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, args.params.app, (ctx) => ctx.services.members.list())
}

/** POST — members.invite: add an existing user, or invite a new email. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.members.invite(body), 201)
}
