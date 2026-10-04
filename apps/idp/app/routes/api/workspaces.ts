import type { Route } from "./+types/workspaces"
import { v1 } from "~/lib/v1.server"

/** GET — workspaces.list_all (superadmin). */
export async function loader(args: Route.LoaderArgs) {
  return v1(args, null, (ctx) => ctx.services.workspaces.list_all())
}
