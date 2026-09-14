import type { Route } from "./+types/apps.$app.members"
import { catalogOf, getApplicationByApp, listAppMembers } from "~/lib/admin.server"
import { requireApiCaller } from "~/lib/caller.server"
import { readJson } from "~/lib/api.server"
import { InviteMemberInput } from "@willyim/idp/schemas"
import { addOrInviteAppMember } from "~/lib/members.server"
import { describeScopeError, resolveScopes } from "~/lib/scopes.server"

/** GET — list this app's members. Requires member:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiCaller(request, context, context.services.auth, {
    app: params.app,
    permission: "member:read",
  })
  const members = await listAppMembers(context, params.app)
  return Response.json({
    members: members.map((m) => ({ ...m, permissions: m.permissions ?? [] })),
  })
}

/** POST — add (existing user) or invite (new email) a member. Requires member:invite. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } })
  }
  // Authenticate only — addOrInviteAppMember owns the member:invite check and
  // the audit entry, so the API and the console can't authorize it differently.
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, InviteMemberInput)

  // Product grants are resolved against the app's catalog exactly as the
  // console resolves them (structure against the declaration, per-instance ids
  // against the app's live list), so the two surfaces cannot disagree about
  // what a grant means. A grant that silently lost a scope is worse than one
  // that failed, so an unresolvable scope is a 422, not a quiet drop.
  const application = await getApplicationByApp(context, params.app)
  const catalog = catalogOf(application)
  const resolved = await resolveScopes(
    body.productPermissions,
    params.app,
    catalog,
    context.services.resources,
  )
  if ("error" in resolved) {
    return Response.json({ error: "invalid_scope", detail: describeScopeError(resolved) }, { status: 422 })
  }

  const res = await addOrInviteAppMember(context, caller, {
    app: params.app,
    email: body.email,
    role: body.role,
    permissions: body.permissions,
    productPermissions: resolved.scopes,
    catalog,
    origin: new URL(request.url).origin,
  })
  if (res.kind === "already-member") {
    return Response.json({ error: "already_member" }, { status: 409 })
  }
  return Response.json({ result: res.kind }, { status: 201 })
}
