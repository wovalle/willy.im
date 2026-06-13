import { redirect } from "react-router"

import type { Route } from "./+types/impersonation.stop"

/**
 * Ends an impersonation session and restores the original admin session. Better
 * Auth swaps the session cookie back (it stashed the admin session token in an
 * `admin_session` cookie when impersonation started), so we forward its
 * Set-Cookie headers on the redirect.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const auth = context.services.auth
  const res = await auth.api.stopImpersonating({
    headers: request.headers,
    asResponse: true,
  })
  const headers = new Headers()
  for (const cookie of res.headers.getSetCookie()) headers.append("set-cookie", cookie)
  return redirect("/", { headers })
}

// Reaching this route with GET just bounces home.
export async function loader() {
  return redirect("/")
}
