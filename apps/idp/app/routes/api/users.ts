import type { Route } from "./+types/users"
import { listUsers, resolveAvatars } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, { superadmin: true })
  const users = await listUsers(context)
  const origin = new URL(request.url).origin
  return Response.json({
    users: resolveAvatars(users, origin).map((u) => ({
      ...u,
      createdAt: new Date(u.createdAt).toISOString(),
    })),
  })
}
