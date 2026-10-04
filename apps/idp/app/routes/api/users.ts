import type { Route } from "./+types/users"
import { v1 } from "~/lib/v1.server"

/** GET — users.list (superadmin). */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, null, (ctx) => ctx.services.users.list())
}
