import { redirect } from "react-router"
import type { AuthService } from "./auth.server"

const ADMIN_EMAILS = ["willyovalle16@gmail.com", "hey@willy.im"]

export const requireAdmin = async (request: Request, auth: AuthService) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session || !ADMIN_EMAILS.includes(session.user.email)) throw redirect("/login")
  return session
}
