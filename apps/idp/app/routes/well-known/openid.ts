import type { Route } from "./+types/openid"
import { proxyWellKnown } from "~/lib/well-known.server"

export function loader({ request, context }: Route.LoaderArgs) {
  return proxyWellKnown(request, context.services.auth, "openid-configuration")
}
