import { ReactNode } from "react"

export type AboutListElementProps = {
  title: string
  subtitle?: string
  id: string
  url: string
  leftPanel?: ReactNode | undefined
  rightPanel?: ReactNode | undefined
  titleSide?: ReactNode | undefined
}

export const AboutListElement: React.FC<AboutListElementProps> = ({
  title,
  subtitle,
  id,
  url,
  leftPanel,
  rightPanel,
  titleSide,
}) => (
  <li
    key={id}
    className="flex py-4 text-sm border-b border-gray-100 dark:border-gray-800 last:border-b-0"
  >
    {leftPanel && <div className="pr-4">{leftPanel}</div>}
    <div className="flex flex-col">
      <div className="flex">
        <a href={url} className="font-semibold text-title">
          {title}
        </a>
        {titleSide}
      </div>
      <p className="text-subsubtitle">{subtitle}</p>
    </div>
    {rightPanel && <div className="flex pl-4 pr-4">{rightPanel}</div>}
  </li>
)
