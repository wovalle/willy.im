import { NavLink, Outlet } from "react-router"
import { ShieldCheck } from "lucide-react"

import type { Route } from "./+types/layout"
import { requireAdminSession } from "~/lib/admin.server"
import { cn } from "~/lib/utils"

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireAdminSession(request, context, context.services.auth)
  return { email: session.user.email }
}

const TABS = [
  { to: "/admin", label: "Applications", end: false },
  { to: "/admin/users", label: "Users", end: true },
]

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-primary size-5" />
          <span className="font-semibold">willy.im IdP — admin</span>
        </div>
        <span className="text-muted-foreground text-sm">{loaderData.email}</span>
      </header>

      <nav className="flex gap-1 border-b">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "border-b-2 px-3 py-2 text-sm no-underline",
                isActive
                  ? "border-primary text-foreground"
                  : "text-muted-foreground border-transparent",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
