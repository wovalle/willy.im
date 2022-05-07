import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons"
import clsx from "clsx"
import { FC, ReactNode, useState } from "react"
import { useAudioPlayer } from "../../hooks/useAudioPlayer"
import { ClientOnly } from "../ClientOnly"

type PlayButtonOverlayProps = {
  diameter: number
  stroke?: number
  children: ReactNode
  audioUrl?: string
}

export const PlayButtonOverlay: FC<PlayButtonOverlayProps> = ({
  stroke = 4,
  children,
  audioUrl,
  diameter,
}) => {
  const audio = useAudioPlayer(audioUrl)
  const [inside, setInside] = useState(false)

  const radius = diameter / 2
  const normalizedRadius = radius - stroke * 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (audio.progress / 100) * circumference

  const Icon = audio.playing ? IconPlayerPause : IconPlayerPlay

  return (
    <ClientOnly>
      <div
        className="relative cursor-pointer"
        onClick={() => audio.toggle()}
        style={{ width: diameter, height: diameter }}
        onMouseEnter={() => setInside(true)}
        onMouseLeave={() => setInside(false)}
      >
        <div
          className={clsx("absolute left-0 top-0 rounded-xl", {
            "opacity-50": !inside && !audio.playing,
            "bg-black/50": inside || audio.playing,
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
    </ClientOnly>
  )
}
