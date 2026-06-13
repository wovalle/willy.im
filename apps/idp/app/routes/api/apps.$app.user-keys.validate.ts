import type { Route } from "./+types/apps.$app.user-keys.validate"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { ValidateUserApiKeyInput } from "~/lib/api-schemas"
import { validateUserApiKey } from "~/lib/user-api-keys.server"

/**
 * POST — validate a presented end-user key for this app. Always 200 with a
 * `valid` discriminator (a miss is data, not an error). Requires
 * userkey:validate, so leaked keys can't be probed anonymously.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  await requireApiPrincipal(request, context, {
    app: params.app,
    permission: "userkey:validate",
  })
  const body = await readJson(request, ValidateUserApiKeyInput)
  const result = await validateUserApiKey(context, { app: params.app, token: body.token })
  return Response.json(result)
}
