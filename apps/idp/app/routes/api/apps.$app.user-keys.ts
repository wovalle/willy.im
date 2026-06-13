import type { Route } from "./+types/apps.$app.user-keys"
import { requireApiPrincipal } from "~/lib/api-keys.server"
import { readJson } from "~/lib/api.server"
import { CreateUserApiKeyInput } from "~/lib/api-schemas"
import { actorFromPrincipal, recordAudit } from "~/lib/audit.server"
import { createUserApiKey, listUserApiKeys } from "~/lib/user-api-keys.server"

/** GET — list end-user API keys (filter: ?userId=&workspaceId=). Requires userkey:read. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireApiPrincipal(request, context, { app: params.app, permission: "userkey:read" })
  const url = new URL(request.url)
  const keys = await listUserApiKeys(context, {
    app: params.app,
    userId: url.searchParams.get("userId") ?? undefined,
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
  })
  return Response.json({
    keys: keys.map((k) => ({
      ...k,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: undefined,
    })),
  })
}

/** POST — mint an end-user API key. Plaintext returned once. Requires userkey:create. */
export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } })
  }
  const principal = await requireApiPrincipal(request, context, {
    app: params.app,
    permission: "userkey:create",
  })
  const body = await readJson(request, CreateUserApiKeyInput)
  const res = await createUserApiKey(context, {
    app: params.app,
    userId: body.userId,
    name: body.name,
    scopes: body.scopes,
    workspaceId: body.workspaceId ?? null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  })
  if ("error" in res) {
    return Response.json({ error: res.error, detail: res.detail }, { status: 422 })
  }
  await recordAudit(context, {
    actor: actorFromPrincipal(principal),
    table: "user_api_key",
    operation: "create",
    applicationId: params.app,
    rowId: res.id,
    after: { userId: body.userId, name: body.name, scopes: body.scopes },
  })
  return Response.json(res, { status: 201 })
}
