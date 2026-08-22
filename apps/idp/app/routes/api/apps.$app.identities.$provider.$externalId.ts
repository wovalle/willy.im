import type { Route } from "./+types/apps.$app.identities.$provider.$externalId"
import { requireApiCaller } from "~/lib/caller.server"
import { resolveIdentity } from "~/lib/identities.server"

/**
 * GET — "who is <provider>:<externalId>, and what may they do in this app?"
 * Always 200 with a `found` discriminator: a miss is data, not an error, and
 * it is the common case in any shared channel. Requires `identity:resolve`,
 * so an external id cannot be probed by a caller holding only read access.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const caller = await requireApiCaller(request, context, context.services.auth)
  const result = await resolveIdentity(context, caller, {
    app: params.app,
    provider: params.provider,
    externalId: params.externalId,
  })
  return Response.json(result)
}
