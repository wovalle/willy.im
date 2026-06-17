import type { Route } from "./+types/applications"
import { listApplications, requireAdminToken } from "~/lib/admin.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  requireAdminToken(request, context)
  const applications = await listApplications(context)
  return Response.json({
    applications: applications.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  })
}
