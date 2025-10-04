import type { FC, ReactNode } from "react"
import { cn } from "~/lib/cn"

export type AboutItemOverlayProps = {
  diameter: number
  children: ReactNode
  overlay?: ReactNode
  extraElementClassName?: string
  analyticsEvent?: string
  analyticsEventData?: string
  onClick?: () => void
  isHovered?: boolean
}

export const AboutItemOverlay: FC<AboutItemOverlayProps> = ({
  children,
  diameter,
  extraElementClassName,
  overlay,
  analyticsEvent,
  analyticsEventData,
  onClick,
  isHovered,
}) => {
  const isHoveredDefined = typeof isHovered !== "undefined"
  const extraClassWithHover = cn(extraElementClassName, {
    "bg-black/50": isHoveredDefined && isHovered,
    "opacity-50": isHoveredDefined && !isHovered,
  })

  return (
    <div
      className={cn("relative cursor-pointer", "aspect-square")}
      style={{ width: diameter, height: diameter }}
      onClick={onClick}
      onKeyDown={onClick}
      data-luchy-event={analyticsEvent}
      data-luchy-event-data={analyticsEventData}
    >
      <div className={cn("absolute left-0 top-0 rounded-xl", extraClassWithHover)}>{overlay}</div>
      {children}
    </div>
  )
}
