import { BiSun, BiMoon } from "react-icons/bi"
import { useTheme } from "next-themes"
import { useState } from "react"
import { useEffect } from "react"
import { FaBars } from "react-icons/fa"
import Link from "next/link"
import { socialMedia } from "../lib/static"

const socialMediaIcons = socialMedia.map(({ name, tooltip, link, icon: Icon }) => (
  <li key={name}>
    <a data-tooltip={tooltip} href={link}>
      <Icon size="1.5em" className="text-black dark:text-white" />
    </a>
  </li>
))

const menu = [
  { name: "Home", url: "/" },
  { name: "About", url: "/about" },
].map((e) => (
  <Link href={e.url} passHref key={e.url}>
    <a>{e.name}</a>
  </Link>
))

const Header = () => {
  const { setTheme, resolvedTheme } = useTheme()
  const [menuIsExpanded, setMenuIsExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  })

  const toggleTheme = () => (resolvedTheme === "dark" ? setTheme("light") : setTheme("dark"))

  const themeIcon =
    resolvedTheme === "dark" ? (
      <BiSun className="text-yellow-500" size="1.5em" />
    ) : (
      <BiMoon className="text-indigo-500" size="1.5em" />
    )

  return (
    <>
      <header className="flex flex-row justify-between p-6">
        {mounted ? (
          <button
            aria-label={`Switch to ${resolvedTheme} theme`}
            className="focus:outline-none"
            onClick={() => {
              toggleTheme()
            }}
          >
            {themeIcon}
          </button>
        ) : (
          <div></div>
        )}
        <div className="flex flex-row items-center">
          <nav className="justify-center hidden space-x-3 md:flex">{menu}</nav>
          <div className="hidden px-4 md:flex">|</div>
          <ul className="flex space-x-1">{socialMediaIcons}</ul>
          <button
            className="flex items-center justify-center w-8 h-8 ml-3 bg-gray-200 md:hidden dark:bg-gray-800"
            onClick={() => setMenuIsExpanded(!menuIsExpanded)}
          >
            <FaBars />
          </button>
        </div>
      </header>
      {menuIsExpanded && (
        <div className="absolute flex flex-col w-full py-4 mt-20 space-y-4 font-semibold bg-white shadow-xl px-7 md:hidden dark:bg-black">
          {menu}
        </div>
      )}
    </>
  )
}

export default Header
