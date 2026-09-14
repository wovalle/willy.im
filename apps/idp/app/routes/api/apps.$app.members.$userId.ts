import type { Route } from "./+types/apps.$app.members.$userId"
import { catalogOf, getApplicationByApp, listAppMembers } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"
import { readJson } from "~/lib/api.server"
import { UpdateMemberInput } from "@willyim/idp/schemas"
import { removeAppMember, updateAppMember } from "~/lib/members.server"
import { describeScopeError, resolveScopes } from "~/lib/scopes.server"

/**
 * PATCH — update a member's role + permissions (member:manage).
 * DELETE — remove a member (member:manage).
 * Both the permission check and the last-admin guard live in members.server;
 * this route only authenticates.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { app, userId } = params

  if (request.method === "PATCH" || request.method === "PUT") {
    const caller = await requireApiCaller(request, context, context.services.auth)
    const body = await readJson(request, UpdateMemberInput)

    // Omitting productPermissions leaves the member's grants alone; sending
    // them REPLACES the set, which is the console's verb too — a merge would
    // leave no way to take a grant away.
    const existing = (await listAppMembers(context, app)).find((m) => m.userId === userId)
    const current = existing?.productPermissions ?? []
    const requested = body.productPermissions ?? current
    const application = await getApplicationByApp(context, app)
    const catalog = catalogOf(application)
    // Only NEW grants are checked against the app's live instance list: a stale
    // grant the member already holds must not block an unrelated edit (same
    // rule as the console, app-detail.tsx).
    const resolved = await resolveScopes(
      requested.filter((s) => !current.includes(s)),
      app,
      catalog,
      context.services.resources,
    )
    if ("error" in resolved) {
      return Response.json({ error: "invalid_scope", detail: describeScopeError(resolved) }, { status: 422 })
    }

    const res = await updateAppMember(context, caller, {
      app,
      userId,
      role: body.role,
      permissions: body.permissions,
      productPermissions: requested,
      catalog,
    })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    return Response.json({ ok: true })
  }

  if (request.method === "DELETE") {
    const caller = await requireApiCaller(request, context, context.services.auth)
    const res = await removeAppMember(context, caller, { app, userId })
    if ("error" in res) return Response.json({ error: res.error }, { status: 409 })
    return Response.json({ ok: true })
  }

  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "PATCH, DELETE" } },
  )
}
