import type { Route } from "./+types/apps.$app.tokens"
import { CreateAppTokenInput } from "@willyim/idp/schemas"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { createAppToken } from "~/lib/app-tokens.server"
import { requireApiCaller } from "~/lib/caller.server"
import { appContext } from "~/context"

/**
 * POST — mint an app token: superadmin authority exchanged for a short-lived
 * `wat_` token bound to this app. Plaintext returned once. Superadmin only (the
 * gate here, the service again below it: the token carries the caller's own
 * power inside the app).
 */
export async function action({ request, context: router, params }: Route.ActionArgs) {
  const context = router.get(appContext)
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const body = await readJson(request, CreateAppTokenInput)
  const res = await createAppToken(
    context,
    caller,
    { app: params.app, ...body },
    { resources: context.services.resources },
  )
  if ("error" in res) {
    // The app's list endpoint being down is not the caller's mistake.
    const status =
      res.error === "not_found" ? 404 : res.error === "resource_lookup_failed" ? 502 : 422
    return Response.json(
      { error: res.error, ...("detail" in res ? { detail: res.detail } : {}) },
      { status },
    )
  }
  return Response.json({ ...res, expiresAt: res.expiresAt.toISOString() }, { status: 201 })
}
