import clsx from "clsx"
import Link from "next/link"
import { FC } from "react"

type MenuLinkProps = { active: boolean; url: string; content: string }

export const MenuLink: FC<MenuLinkProps> = ({ active, url, content }) => (
  <Link
    href={url}
    key={url}
    className={clsx("leading-10", active ? "active" : "border-transparent")}
  >
    {content}
  </Link>
)
