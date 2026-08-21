import type { Route } from "./+types/admin-keys"
import { createAdminKey, listAdminKeys } from "~/lib/api-keys.server"
import { methodNotAllowed, readJson } from "~/lib/api.server"
import { requireApiCaller } from "~/lib/caller.server"
import { CreateAdminKeyInput } from "@willyim/idp/schemas"

/** GET — every IdP-level admin key. Superadmin only. Never returns the hashes. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const keys = await listAdminKeys(context, caller)
  return Response.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      status: k.status,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  })
}

/**
 * POST — mint an admin key. Plaintext returned once. Superadmin only (the gate
 * here, the service again below it: this hands out superadmin, so it is worth
 * paying for the second check).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed(["GET", "POST"])
  const caller = await requireApiCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const body = await readJson(request, CreateAdminKeyInput)
  const created = await createAdminKey(context, caller, {
    name: body.name,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  })
  return Response.json(created, { status: 201 })
}
