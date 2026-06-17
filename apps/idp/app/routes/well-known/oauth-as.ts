import type { Route } from "./+types/oauth-as"
import { proxyWellKnown } from "~/lib/well-known.server"

export function loader({ request, context }: Route.LoaderArgs) {
  return proxyWellKnown(request, context.services.auth, "oauth-authorization-server")
}
