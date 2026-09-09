import type { Route } from "./+types/app-resources"
import { getApplication } from "~/lib/admin.server"
import { requireConsoleCaller } from "~/lib/caller.server"
import { ResourceListError } from "~/lib/resources.server"

/**
 * GET `?type=<declared resource type>` — the instances the app currently holds
 * for one of its declared resource types, for the console's grant picker.
 *
 * The IdP stores grants, never instances (see resources.server.ts), so this is
 * a live pass-through to the app's own `list` URL. That makes the response the
 * APP's data — conversation titles, document names — not IdP metadata, so it is
 * gated on being able to GRANT it: `member:invite` or `member:manage`. Anyone
 * else holding `app:read` can see that a type exists (the Access tab lists the
 * declaration) without being handed the contents.
 *
 * A listing failure answers 502 with the reason rather than an empty array: an
 * empty list reads as "nothing to pick", which is a different and wrong answer.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const type = new URL(request.url).searchParams.get("type")
  if (!type) return Response.json({ error: "type_required" }, { status: 400 })

  const application = await getApplication(context, params.clientId)
  const app = application?.app
  if (!application || !app) return Response.json({ error: "not_found" }, { status: 404 })

  const caller = await requireConsoleCaller(request, context, context.services.auth)
  const mayGrant =
    (await caller.can(app, "member:invite")) || (await caller.can(app, "member:manage"))
  if (!mayGrant) return Response.json({ error: "forbidden" }, { status: 403 })

  const declared = application.resourceTypes.find((t) => t.type === type)
  if (!declared) return Response.json({ error: "unknown_type" }, { status: 404 })

  try {
    const resources = await context.services.resources({ app, type: declared })
    return Response.json({ resources })
  } catch (err) {
    if (!(err instanceof ResourceListError)) throw err
    return Response.json(
      { error: "resource_lookup_failed", detail: err.message },
      { status: 502 },
    )
  }
}
