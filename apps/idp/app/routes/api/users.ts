import type { Route } from "./+types/users"
import { listUsers } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, { superadmin: true })
  const users = await listUsers(context)
  return Response.json({
    users: users.map((u) => ({ ...u, createdAt: new Date(u.createdAt).toISOString() })),
  })
}
