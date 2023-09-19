import Link from "next/link"
import { FC } from "react"
import { cn } from "../../../utils/cn"

type MenuLinkProps = { active: boolean; url: string; content: string }

export const MenuLink: FC<MenuLinkProps> = ({ active, url, content }) => (
  <Link href={url} key={url} className={cn("leading-10", active ? "active" : "border-transparent")}>
    {content}
  </Link>
)
