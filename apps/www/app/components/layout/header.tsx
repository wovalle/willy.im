import { IconMoon, IconSun } from "@tabler/icons-react"
import { Link, useLocation } from "react-router"

import { useState } from "react"
import { cn } from "~/lib/cn"
import { navLinks } from "~/static"

export const Header = () => {
  const [theme, setTheme] = useState<"light" | "dark">("light")

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

  const themeIcon =
    theme === "dark" ? (
      <IconSun size="1.5em" className="hover:text-amber-200" />
    ) : (
      <IconMoon size="1.5em" className="hover:text-neuda" />
    )

  return (
    <header className="flex w-full max-w-4xl flex-row items-center justify-between self-center p-6">
      <nav className="flex gap-10">{links}</nav>

      <button
        type="button"
        data-luchy-event="toggle-theme-pressed"
        data-luchy-event-data={theme}
        onClick={() => {
          setTheme((theme) => (theme === "dark" ? "light" : "dark"))
        }}
        className="md:block"
      >
        {themeIcon}
      </button>
    </header>
  )
}
