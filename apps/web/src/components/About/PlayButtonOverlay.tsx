import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react"
import clsx from "clsx"
import { FC, ReactNode } from "react"
import { useAudioPlayer } from "../../hooks"

type PlayButtonOverlayProps = {
  diameter: number
  stroke?: number
  children: ReactNode
  audioUrl?: string
  isHovered: boolean
}

export const PlayButtonOverlay: FC<PlayButtonOverlayProps> = ({
  stroke = 4,
  children,
  audioUrl,
  diameter,
  isHovered,
}) => {
  const audio = useAudioPlayer(audioUrl)

  const radius = diameter / 2
  const normalizedRadius = radius - stroke * 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (audio.progress / 100) * circumference

  const Icon = audio.playing ? IconPlayerPause : IconPlayerPlay

  return (
    <div
      className={clsx("relative cursor-pointer", "aspect-square")}
      style={{ width: diameter, height: diameter }}
      onClick={() => audio.toggle()}
    >
      <div
        className={clsx("absolute left-0 top-0 rounded-xl", {
          "opacity-50": !isHovered && !audio.playing,
          "bg-black/50": isHovered || audio.playing,
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
