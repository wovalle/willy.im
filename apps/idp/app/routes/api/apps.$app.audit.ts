import type { Route } from "./+types/apps.$app.audit"
import { v1 } from "~/lib/v1.server"

/** GET — audit.list (?limit=, 1 to 200, default 50). */
export async function loader(args: Route.LoaderArgs) {
  const limit = Number(new URL(args.request.url).searchParams.get("limit"))
  return v1(args, args.params.app, (ctx) =>
    ctx.services.audit.list({ limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50 }),
  )
}
