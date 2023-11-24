"use client"

import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react"
import clsx from "clsx"
import { FC } from "react"
import { useAudioPlayer } from "../hooks/useAudioPlayer"
import { AboutItemOverlay, AboutItemOverlayProps } from "./AboutItemOverlay"

type PlayButtonOverlayProps = Omit<
  AboutItemOverlayProps,
  "overlay" | "analyticsEvent" | "analyticsEventData" | "extraElementClassName"
> & {
  stroke?: number
  url: string
  isHovered: boolean
}

export const PlayButtonOverlay: FC<PlayButtonOverlayProps> = ({
  stroke = 4,
  children,
  diameter,
  isHovered,
  url,
}) => {
  const player = useAudioPlayer()
  const radius = diameter / 2
  const isPlaying = player.isPlayingUrl(url)
  const normalizedRadius = radius - stroke * 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (player.getProgress(url) / 100) * circumference

  const Icon = isPlaying ? IconPlayerPause : IconPlayerPlay

  const overlay = (
    <>
      <div className="absolute" style={{ top: radius - 10, left: radius - 10 }}>
        <Icon size={20} className="stroke-white" />
      </div>
      <svg height={diameter} width={diameter}>
        <circle
          className={clsx("stroke-white")}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + " " + circumference}
          style={{ strokeDashoffset, transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
    </>
  )

  return (
    <AboutItemOverlay
      diameter={diameter}
      extraElementClassName={clsx({
        "opacity-50": !isHovered && !isPlaying,
        "bg-black/50": isHovered || isPlaying,
      })}
      overlay={overlay}
      onClick={() => {
        player.toggle(url)
      }}
      analyticsEvent={isPlaying ? "pause-button-click" : "play-button-click"}
      analyticsEventData={url}
    >
      {children}
    </AboutItemOverlay>
  )
}
