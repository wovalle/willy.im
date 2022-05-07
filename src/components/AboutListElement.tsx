import { IconExternalLink } from "@tabler/icons"
import Link from "next/link"
import { ReactNode } from "react"
import { useHover } from "../hooks"

export type AboutListElementProps = {
  title: ReactNode
  subtitle?: ReactNode
  url: string
  leftPanel?: (isHovered: boolean) => ReactNode | ReactNode
}

export const AboutListElement: React.FC<AboutListElementProps> = ({
  title,
  subtitle,
  url,
  leftPanel,
}) => {
  const { isHovered, hoverProps } = useHover()

  return (
    <li
      className="flex items-center gap-2 rounded-xl p-2 text-sm hover:bg-slate-200 dark:border-gray-800 dark:hover:bg-slate-800"
      {...hoverProps}
    >
      {typeof leftPanel === "function" ? leftPanel(isHovered) : leftPanel}
      <div className="flex w-full flex-row justify-between md:justify-start">
        <div className="flex flex-col">
          <Link href={url} className="text-title flex border-transparent" target="_blank">
            {title} <IconExternalLink className="ml-1 self-center" size="1em" />
          </Link>
          <p className="text-subtitle">{subtitle}</p>
        </div>
      </div>
    </li>
  )
}
