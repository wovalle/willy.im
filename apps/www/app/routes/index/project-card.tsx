import { IconArrowUpRight } from "@tabler/icons-react"
import type { FC } from "react"
import { Link } from "react-router"

export const ProjectCard: FC<{
  to: string
  name: string
  description: string
}> = ({ to, name, description }) => {
  return (
    <div className="flex flex-col">
      <Link
        to={to}
        className="flex items-center gap-1 font-medium"
        data-luchy-event="project-click"
        data-luchy-prop-name={name}
      >
        {name} <IconArrowUpRight size="1em" aria-hidden />
      </Link>
      <div className="mt-1 text-xs">{description}</div>
    </div>
  )
}
