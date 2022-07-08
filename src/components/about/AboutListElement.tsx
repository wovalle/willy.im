import { IconExternalLink } from "@tabler/icons"
import clsx from "clsx"
import Link from "next/link"
import { ReactNode } from "react"
import { useHover } from "../../hooks"

export type AboutListElementProps = {
  title: ReactNode
  subtitle?: ReactNode
  url: string
  leftPanel?: (isHovered: boolean) => ReactNode | ReactNode
  withHover?: boolean
}

export const AboutListElement: React.FC<AboutListElementProps> = ({
  title,
  subtitle,
  url,
  leftPanel,
  withHover = true,
}) => {
  const { isHovered, hoverProps } = useHover()

  return (
    <li
      className={clsx("flex items-center gap-2 rounded-xl p-2 text-sm  dark:border-gray-800 ", {
        "hover:bg-slate-200 dark:hover:bg-slate-800": withHover,
      })}
      {...hoverProps}
    >
      {typeof leftPanel === "function" ? leftPanel(isHovered) : leftPanel}
      <div className="flex w-full flex-row justify-between md:justify-start">
        <div className="flex flex-col">
          <Link
            href={url}
            className="text-title flex border-transparent"
            target="_blank"
            rel="noopener noreferrer"
          >
            {title} <IconExternalLink className="ml-1 self-center" size="1em" />
          </Link>
          <p className="text-subtitle">{subtitle}</p>
        </div>
      </div>
    </li>
  )
}
