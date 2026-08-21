import type { Route } from "./+types/apps.$app.keys"
import { createApiKey, listApiKeys } from "~/lib/api-keys.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { CreateApiKeyInput } from "@willyim/idp/schemas"

/** GET — this app's scoped management keys. Requires `apikey:read`. Never hashes. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const caller = await requireApiCaller(request, context, context.services.auth)
  const keys = await listApiKeys(context, caller, params.app)
  return Response.json({
    keys: keys.map((k) => ({
      ...k,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  })
}

/**
 * POST — mint a scoped management key. Plaintext returned once. Requires
 * `apikey:create` and that the requested permissions are a subset of the
 * caller's own (both enforced by the service).
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["POST"])
  const caller = await requireApiCaller(request, context, context.services.auth)
  const body = await readJson(request, CreateApiKeyInput)
  const created = await createApiKey(context, caller, {
    app: params.app,
    name: body.name,
    permissions: body.permissions,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  })
  if ("error" in created)
    return Response.json({ error: created.error, detail: created.detail }, { status: 403 })
  return Response.json(created, { status: 201 })
}
