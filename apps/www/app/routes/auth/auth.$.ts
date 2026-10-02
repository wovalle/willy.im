import type { Route } from "./+types/auth.$.js"
import { appContext } from "~/context"

export async function loader({ request, context: router }: Route.LoaderArgs) {
  const context = router.get(appContext)
  return context.services.auth.handler(request)
}

export async function action({ request, context: router }: Route.ActionArgs) {
  const context = router.get(appContext)
  return context.services.auth.handler(request)
}
