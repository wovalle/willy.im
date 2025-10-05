import { Link, useLocation } from "react-router"

import { cn } from "~/lib/cn"
import { navLinks } from "~/static"

export const Header = () => {
  const location = useLocation()

  const currentPathIsActive = (url: string) => {
    if (url === "/") {
      return location.pathname === url
    }

    return location.pathname.startsWith(url)
  }

  const links = navLinks
    .filter((link) => link.in.includes("header"))
    .map((link) => (
      <Link
        key={link.url}
        to={link.url}
        className={cn("leading-10", { active: currentPathIsActive(link.url) })}
      >
        {link.name}
      </Link>
    ))

  return (
    <header className="flex w-full max-w-4xl flex-row items-center justify-between self-center p-6">
      <nav className="flex gap-10">{links}</nav>
    </header>
  )
}
