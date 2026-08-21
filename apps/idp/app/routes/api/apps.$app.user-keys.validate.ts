import type { Route } from "./+types/apps.$app.user-keys.validate"
import { requireApiCaller } from "~/lib/caller.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { ValidateUserApiKeyInput } from "@willyim/idp/schemas"
import { validateUserApiKey } from "~/lib/user-api-keys.server"

/**
 * POST — validate a presented end-user key for this app. Always 200 with a
 * `valid` discriminator (a miss is data, not an error). The service requires
 * userkey:validate, so leaked keys can't be probed anonymously.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, ValidateUserApiKeyInput)
  const result = await validateUserApiKey(context, caller, { app: params.app, token: body.token })
  return Response.json(result)
}
