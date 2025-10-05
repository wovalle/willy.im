import { Link } from "react-router"

import { navLinks } from "~/static"

export const Footer = (opts: { divider?: boolean }) => {
  const links = navLinks
    .filter((link) => link.in.includes("footer"))
    .map(({ name, url }) => (
      <Link key={name} to={url} className="border-transparent">
        {name}
      </Link>
    ))

  return (
    <footer className="grid gap-6 p-6">
      {opts.divider && (
        <hr className="border-1 mx-auto w-4/5 border-gray-200 dark:border-gray-800" />
      )}

      <ul className="flex flex-row justify-center gap-4">{links}</ul>
    </footer>
  )
}
