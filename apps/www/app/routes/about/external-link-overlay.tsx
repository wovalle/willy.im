import { IconExternalLink } from "@tabler/icons-react"
import { cn } from "~/lib/cn"
import { AboutItemOverlay, type AboutItemOverlayProps } from "./about-item-overlay"

type ExternalLinkOverlayProps = Omit<
  AboutItemOverlayProps,
  "overlay" | "analyticsEvent" | "analyticsEventData" | "extraElementClassName"
> & {
  url: string
  isHovered: boolean
}

export const ExternalLinkOverlay = ({
  children,
  diameter,
  isHovered,
  url,
}: ExternalLinkOverlayProps) => {
  const radius = diameter / 2

  const overlay = (
    <div className="absolute" style={{ top: radius - 10, left: radius - 10 }}>
      <IconExternalLink size={20} className="stroke-white" />
    </div>
  )

  return (
    <AboutItemOverlay
      diameter={diameter}
      extraElementClassName={cn({
        "opacity-40": !isHovered,
        "bg-black/70": isHovered,
      })}
      overlay={overlay}
      onClick={() => {
        window.open(url, "_blank", "noopener,noreferrer")
      }}
      analyticsEvent="external-link-click"
      analyticsEventData={url}
    >
      {children}
    </AboutItemOverlay>
  )
}
