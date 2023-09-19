"use client"

import { IconMoon, IconSun } from "@tabler/icons-react"
import { useTheme } from "next-themes"
import Link from "next/link"
import { useMenuItems } from "../../hooks/useMenuItems"
import Logo from "../core/Logo"

import { HamburgerMenu } from "./HamburgerMenu"
import { MenuLink } from "./MenuLink"

export const Header = () => {
  const { setTheme, resolvedTheme } = useTheme()

  const toggleTheme = () => (resolvedTheme === "dark" ? setTheme("light") : setTheme("dark"))

  const themeIcon =
    resolvedTheme === "dark" ? (
      <IconSun size="1.5em" className="hover:text-amber-200" />
    ) : (
      <IconMoon size="1.5em" className="hover:text-neuda" />
    )

  const menuItems = useMenuItems().map((item) => (
    <li key={item.url}>
      <MenuLink active={item.active} url={item.url} content={item.name} />
    </li>
  ))

  return (
    <header className="flex flex-row justify-between p-6">
      <Link href="/" className="border-transparent md:hidden">
        <Logo className="h-10 w-10" />
      </Link>

      <nav className="hidden list-none justify-between gap-10 md:flex">{menuItems}</nav>

      <button
        data-luchy-event="toggle-theme-pressed"
        data-luchy-event-data={resolvedTheme}
        onClick={() => {
          toggleTheme()
        }}
        className="hidden md:block"
      >
        {themeIcon}
      </button>
      <HamburgerMenu
        toggleTheme={toggleTheme}
        toggleThemeButtonLabel={
          <>
            {themeIcon} change to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </>
        }
      />
    </header>
  )
}
