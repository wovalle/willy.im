import type { Route } from "./+types/apps.$app.audit"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { listAuditForApp } from "~/lib/audit.server"

/** GET — recent audit entries for this app (newest first). Requires audit:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiPrincipal(request, context, { app: params.app, permission: "audit:read" })
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50
  const entries = await listAuditForApp(context, params.app, limit)
  return Response.json({ entries })
}
