import { buildOpenApiDocument } from "@willyim/idp/schemas/openapi"

import type { Route } from "./+types/openapi"

/**
 * The document is built from the operations table in `@willyim/idp/schemas`,
 * the same one the SDK validates responses against — so what we publish and
 * what we serve cannot drift.
 */
export async function loader({ context }: Route.LoaderArgs) {
  return Response.json(buildOpenApiDocument({ baseUrl: context.getAppEnv("BETTER_AUTH_URL") }))
}
