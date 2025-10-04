import { IconExternalLink } from "@tabler/icons-react"
import type { FC, ReactNode } from "react"
import { Link } from "react-router"
import { useHover } from "~/hooks/use-hover"
import { cn } from "~/lib/cn"

export type AboutListElementProps = {
  title: ReactNode
  subtitle?: ReactNode
  url: string
  leftPanel?: (isHovered: boolean) => ReactNode | ReactNode
  withHover?: boolean
}

export const AboutListElement: FC<AboutListElementProps> = ({
  title,
  subtitle,
  url,
  leftPanel,
  withHover = true,
}) => {
  const { isHovered, hoverProps } = useHover()

  return (
    <li
      className={cn("flex items-center gap-4 rounded-xl p-2 text-sm dark:border-gray-800", {
        "hover:bg-stone-200 dark:hover:bg-stone-700": withHover,
      })}
      {...hoverProps}
    >
      {typeof leftPanel === "function" ? leftPanel(isHovered) : leftPanel}
      <div className="flex w-full flex-col justify-between md:justify-start">
        <Link
          to={url}
          className="text-title flex border-transparent"
          target="_blank"
          rel="noopener noreferrer"
          data-luchy-event="about-link-click"
          data-luchy-event-data={url}
        >
          {title} <IconExternalLink className="ml-1 self-center" size="1em" />
        </Link>
        <p className="text-subtitle">{subtitle}</p>
      </div>
    </li>
  )
}
