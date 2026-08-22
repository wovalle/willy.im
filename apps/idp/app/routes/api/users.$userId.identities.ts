import type { Route } from "./+types/users.$userId.identities"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { linkIdentity, listLinkedIdentities } from "~/lib/identities.server"
import { LinkIdentityInput } from "@willyim/idp/schemas"

/** GET — every external identity pinned to this user. Superadmin only. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const identities = await listLinkedIdentities(context, caller, { userId: params.userId })
  return Response.json({
    identities: identities.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
  })
}

/**
 * POST — pin an external id to this user. 201 on a new link, 200 when the same
 * pair was already this user's, 409 when it belongs to someone else. Superadmin
 * only: a link asserts identity with nothing to prove it.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const body = await readJson(request, LinkIdentityInput)
  const res = await linkIdentity(context, caller, {
    userId: params.userId,
    provider: body.provider,
    externalId: body.externalId,
    label: body.label ?? null,
  })
  if ("error" in res) {
    const status = res.error === "unknown_user" ? 404 : 409
    return Response.json(res, { status })
  }
  return Response.json(res, { status: res.created ? 201 : 200 })
}
