import type { Route } from "./+types/auth.$.js"

export async function loader({ request, context }: Route.LoaderArgs) {
  return context.services.auth.handler(request)
}

export async function action({ request, context }: Route.ActionArgs) {
  return context.services.auth.handler(request)
}
