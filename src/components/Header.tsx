import { Menu } from "@headlessui/react"
import { IconMenu, IconMoon, IconSun } from "@tabler/icons"
import clsx from "clsx"
import { useTheme } from "next-themes"
import Link from "next/link"
import { useRouter } from "next/router"
import { FC, useCallback } from "react"
import { footerLinks } from "../lib/static"
import { ClientOnly } from "./ClientOnly"
import Logo from "./Logo"

type MenuLinkProps = { active: boolean; url: string; content: string }

const MenuLink: FC<MenuLinkProps> = ({ active, url, content }) => (
  <Link
    href={url}
    key={url}
    className={clsx("leading-10", active ? "active" : "border-transparent")}
  >
    {content}
  </Link>
)

const Header = () => {
  const { setTheme, resolvedTheme } = useTheme()
  const router = useRouter()

  const toggleTheme = () => (resolvedTheme === "dark" ? setTheme("light") : setTheme("dark"))
  const themeIcon =
    resolvedTheme === "dark" ? (
      <IconSun size="1.5em" className="hover:text-amber-200" />
    ) : (
      <IconMoon size="1.5em" className="hover:text-neuda" />
    )

  const getMenuItems = useCallback(
    (inMenu: boolean) =>
      footerLinks.map((e) => {
        const active = router.pathname === e.url

        return inMenu ? (
          <Menu.Item as="li" key={e.url}>
            <MenuLink active={active} url={e.url} content={e.name} />
          </Menu.Item>
        ) : (
          <li key={e.url}>
            <MenuLink active={active} url={e.url} content={e.name} />
          </li>
        )
      }),
    []
  )

  return (
    <header className="flex flex-row justify-between p-6">
      <Link href="/" className="border-transparent md:hidden">
        <Logo className="h-10 w-10" />
      </Link>

      <nav className="hidden list-none justify-between gap-10 md:flex">{getMenuItems(false)}</nav>

      <ClientOnly>
        <button
          onClick={() => {
            toggleTheme()
          }}
          className="hidden md:block"
        >
          {themeIcon}
        </button>
      </ClientOnly>
      <Menu>
        {({ open }) => (
          <>
            <Menu.Button
              className={clsx(
                open && "bg-slate-100",
                "flex h-10 w-10 items-center justify-center space-y-8 rounded-lg dark:bg-gray-800 md:hidden"
              )}
            >
              <IconMenu className="h-10" />
            </Menu.Button>
            <Menu.Items
              className="absolute right-0 z-10 mt-12 flex w-full flex-col items-center gap-8 rounded-lg bg-white p-8 font-semibold shadow-md dark:bg-black dark:shadow-neuda-700 md:hidden"
              as="ul"
            >
              {getMenuItems(true)}
              <Menu.Item as="li">
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-slate-100 p-4 font-bold hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800"
                  onClick={() => toggleTheme()}
                >
                  {themeIcon}
                  change to {resolvedTheme === "dark" ? "light" : "dark"} theme
                </button>
              </Menu.Item>
            </Menu.Items>
          </>
        )}
      </Menu>
    </header>
  )
}

export default Header
