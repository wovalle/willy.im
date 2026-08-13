import type { Route } from "./+types/applications"
import { listApplications } from "~/lib/admin.server"
import { requireSuperadminApi } from "~/lib/api-keys.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireSuperadminApi(request, context)
  const applications = await listApplications(context)
  return Response.json({
    applications: applications.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  })
}
