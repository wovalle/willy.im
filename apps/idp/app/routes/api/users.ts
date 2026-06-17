import type { Route } from "./+types/users"
import { listUsers, requireAdminToken } from "~/lib/admin.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  requireAdminToken(request, context)
  const users = await listUsers(context)
  return Response.json({
    users: users.map((u) => ({ ...u, createdAt: new Date(u.createdAt).toISOString() })),
  })
}
