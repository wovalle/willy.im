"use client"

import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react"
import clsx from "clsx"
import { FC, ReactNode } from "react"
import { useAudioPlayer } from "../hooks/useAudioPlayer"

type PlayButtonOverlayProps = {
  diameter: number
  stroke?: number
  children: ReactNode
  isHovered: boolean
  url: string
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

  return (
    <div
      className={clsx("relative cursor-pointer", "aspect-square")}
      style={{ width: diameter, height: diameter }}
      onClick={() => player.toggle(url)}
      data-luchy-event={isPlaying ? "play-button-click" : "pause-button-click"}
      data-luchy-event-data={url}
    >
      <div
        className={clsx("absolute left-0 top-0 rounded-xl", {
          "opacity-50": !isHovered && !isPlaying,
          "bg-black/50": isHovered || isPlaying,
        })}
      >
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
      </div>
      {children}
    </div>
  )
}
