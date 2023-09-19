import { useState } from "react"

export const useHover = () => {
  const [hover, setHover] = useState(false)

  return {
    isHovered: hover,
    hoverProps: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  }
}
