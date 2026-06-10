import type { Route } from "./+types/apps.$app.members"
import { listAppMembers } from "~/lib/admin.server"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { readJson } from "~/lib/api.server"
import { InviteMemberInput } from "~/lib/api-schemas"
import { actorFromPrincipal, recordAudit } from "~/lib/audit.server"
import { addOrInviteAppMember } from "~/lib/members.server"

/** GET — list this app's members. Requires member:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiPrincipal(request, context, { app: params.app, permission: "member:read" })
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
  const principal = await requireApiPrincipal(request, context, {
    app: params.app,
    permission: "member:invite",
  })
  const body = await readJson(request, InviteMemberInput)

  const res = await addOrInviteAppMember(context, {
    app: params.app,
    email: body.email,
    role: body.role,
    permissions: body.permissions,
    invitedByUserId: null,
    origin: new URL(request.url).origin,
  })
  if (res.kind === "already-member") {
    return Response.json({ error: "already_member" }, { status: 409 })
  }
  await recordAudit(context, {
    actor: actorFromPrincipal(principal),
    table: res.kind === "added" ? "application_member" : "application_invitation",
    operation: "invite",
    applicationId: params.app,
    after: { email: body.email, role: body.role, permissions: body.permissions, result: res.kind },
  })
  return Response.json({ result: res.kind }, { status: 201 })
}
