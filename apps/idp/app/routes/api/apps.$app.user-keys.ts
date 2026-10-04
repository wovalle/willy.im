import type { Route } from "./+types/apps.$app.user-keys"
import { methodNotAllowed, v1 } from "~/lib/v1.server"

/** GET — user_keys.list (filter: ?userId=&workspaceId=). */
export async function loader(args: Route.LoaderArgs) {
  const query = new URL(args.request.url).searchParams
  return v1(args, args.params.app, (ctx) =>
    ctx.services.user_keys.list({
      userId: query.get("userId") ?? undefined,
      workspaceId: query.get("workspaceId") ?? undefined,
    }),
  )
}

/** POST — user_keys.mint. */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return methodNotAllowed(["POST"])
  return v1(args, args.params.app, (ctx, body) => ctx.services.user_keys.mint(body), 201)
}
