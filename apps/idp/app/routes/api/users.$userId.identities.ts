import type { Route } from "./+types/users.$userId.identities"
import { methodNotAllowed } from "~/lib/api.server"
import { v1 } from "~/lib/v1.server"

/** GET — identities.list (superadmin). */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, null, (ctx) => ctx.services.identities.list({ userId: args.params.userId }))
}

/** POST — identities.link (superadmin): 201 on a new link, 200 when it was already theirs. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  const { userId } = args.params
  return v1(
    args,
    null,
    (ctx, body) => ctx.services.identities.link({ ...body, userId }),
    (res) => (res.created ? 201 : 200),
  )
}
