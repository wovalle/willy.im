import type { Route } from "./+types/openid"
import { proxyWellKnown } from "~/lib/well-known.server"
import { appContext } from "~/context"

export function loader({ request, context: router }: Route.LoaderArgs) {
  const context = router.get(appContext)
  return proxyWellKnown(request, context.services.auth, "openid-configuration")
}
