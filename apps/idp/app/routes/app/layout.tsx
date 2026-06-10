import { Form, Link, Outlet, useLocation, useNavigate } from "react-router"
import { ShieldCheck, UserCog } from "lucide-react"

import type { Route } from "./+types/layout"
import { isAdminEmail, requireSession } from "~/lib/admin.server"
import { cn } from "~/lib/utils"

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireSession(request, context, context.services.auth)
  return {
    email: session.user.email,
    isAdmin: isAdminEmail(context, session.user.email),
    // Set on impersonation sessions (Better Auth admin plugin).
    impersonating: !!session.session.impersonatedBy,
  }
}

export default function ConsoleLayout({ loaderData }: Route.ComponentProps) {
  const { email, isAdmin, impersonating } = loaderData
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const tabs = [
    ...(isAdmin
      ? [
          { to: "/", label: "Applications", active: pathname === "/" || pathname.startsWith("/apps") },
          { to: "/users", label: "Users", active: pathname.startsWith("/users") },
        ]
      : []),
    { to: "/account", label: "Account", active: pathname.startsWith("/account") },
  ]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 p-6">
      {impersonating ? (
        <div className="bg-amber-500/15 text-amber-700 dark:text-amber-400 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <UserCog className="size-4" />
            Impersonating <span className="font-medium">{email}</span> — actions run as this user.
          </span>
          <Form method="post" action="/impersonation/stop">
            <button
              type="submit"
              className="rounded-md border border-amber-500/50 px-2 py-1 text-xs font-medium hover:bg-amber-500/20"
            >
              Stop impersonating
            </button>
          </Form>
        </div>
      ) : null}
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <ShieldCheck className="text-primary size-5" />
          <span className="font-semibold">willy.im IdP</span>
        </Link>
        <button
          type="button"
          onClick={() => navigate("/account")}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          {email}
        </button>
      </header>

      <nav className="flex gap-1 border-b" aria-label="Primary">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm no-underline transition-colors",
              t.active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <main id="main">
        <Outlet />
      </main>
    </div>
  )
}
