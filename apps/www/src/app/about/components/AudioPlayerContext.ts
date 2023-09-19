import { createContext } from "react"

type AudioPlayerContextValue = {
  audioUrl?: string
  setAudioUrl: (audioUrl?: string) => void
}

export const AudioPlayerContext = createContext<AudioPlayerContextValue>({
  audioUrl: undefined,
  setAudioUrl: () => {},
})
