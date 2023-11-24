"use client"

import clsx from "clsx"
import { FC, ReactNode } from "react"

export type AboutItemOverlayProps = {
  diameter: number
  children: ReactNode
  overlay?: ReactNode
  extraElementClassName?: string
  analyticsEvent?: string
  analyticsEventData?: string
  onClick?: () => void
}

export const AboutItemOverlay: FC<AboutItemOverlayProps> = ({
  children,
  diameter,
  extraElementClassName,
  overlay,
  analyticsEvent,
  analyticsEventData,
  onClick,
}) => {
  return (
    <div
      className={clsx("relative cursor-pointer", "aspect-square")}
      style={{ width: diameter, height: diameter }}
      onClick={onClick}
      data-luchy-event={analyticsEvent}
      data-luchy-event-data={analyticsEventData}
    >
      <div className={clsx("absolute left-0 top-0 rounded-xl", extraElementClassName)}>
        {overlay}
      </div>
      {children}
    </div>
  )
}
