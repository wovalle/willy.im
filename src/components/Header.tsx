import { BiSun, BiMoon } from "react-icons/bi"
import { useTheme } from "next-themes"
import { useState } from "react"
import { useEffect } from "react"
import { FaGithub, FaTwitter, FaInstagram, FaLinkedin, FaTelegram, FaBars } from "react-icons/fa"
import Link from "next/link"

const socialMedia = [
  {
    name: "twitter",
    tooltip: "Willy's Twitter",
    link: "//twitter.com/wovalle",
    icon: FaTwitter,
  },
  {
    name: "github",
    tooltip: "Willy's Github",
    link: "//github.com/wovalle",
    icon: FaGithub,
  },
  {
    name: "instagram",
    tooltip: "Willy's Instagram",
    link: "//instagram.com/wovalle",
    icon: FaInstagram,
  },
  {
    name: "linkedin",
    tooltip: "Willy's LinkedIn",
    link: "//linkedin.com/in/willyovalle",
    icon: FaLinkedin,
  },
  {
    name: "telegram",
    tooltip: "Willy's Telegram",
    link: "//t.me/wovalle",
    icon: FaTelegram,
  },
].map(({ name, tooltip, link, icon: Icon }) => (
  <li key={name}>
    <a data-tooltip={tooltip} href={link}>
      <Icon size="1.5em" className="dark:text-white text-black" />
    </a>
  </li>
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

  const menu = [
    { name: "Home", url: "/" },
    { name: "About", url: "/about" },
  ].map((e) => (
    <Link href={e.url} passHref key={e.url}>
      <a>{e.name}</a>
    </Link>
  ))
  return (
    <>
      <header className="p-6 flex flex-row justify-between">
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
          <nav className="hidden md:flex space-x-3 justify-center">{menu}</nav>
          <div className="hidden md:flex px-4">|</div>
          <ul className="flex space-x-1">{socialMedia}</ul>
          <button
            className="md:hidden ml-3 w-8 h-8 bg-gray-200 dark:bg-gray-800 flex justify-center items-center"
            onClick={() => setMenuIsExpanded(!menuIsExpanded)}
          >
            <FaBars />
          </button>
        </div>
      </header>
      {menuIsExpanded && (
        <div className="flex flex-col space-y-4 py-4 px-7 md:hidden font-semibold absolute w-full mt-20 bg-white dark:bg-black shadow-xl">
          {menu}
        </div>
      )}
    </>
  )
}

export default Header
