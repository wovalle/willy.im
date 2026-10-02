import { buildOpenApiDocument } from "@willyim/idp/schemas/openapi"

import type { Route } from "./+types/openapi"
import { appContext } from "~/context"

/**
 * The document is built from the operations table in `@willyim/idp/schemas`,
 * the same one the SDK validates responses against — so what we publish and
 * what we serve cannot drift.
 */
export async function loader({ context: router }: Route.LoaderArgs) {
  const context = router.get(appContext)
  return Response.json(buildOpenApiDocument({ baseUrl: context.getAppEnv("BETTER_AUTH_URL") }))
}
