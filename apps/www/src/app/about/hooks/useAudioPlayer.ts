import { useContext, useEffect, useMemo, useState } from "react"
import { AudioPlayerContext } from "../components/AudioPlayerContext"

export const useAudioPlayer = () => {
  const { audioUrl, setAudioUrl } = useContext(AudioPlayerContext)
  const [progress, setProgress] = useState(0)
  const audio = useMemo(() => new Audio(audioUrl), [audioUrl])

  // When an audioUrl is assigned, we need to play it
  // When hook is unmounted, we need to pause the audio
  useEffect(() => {
    async function play() {
      await audio?.play()
    }

    if (audioUrl) {
      void play()
    }

    return () => {
      audio?.pause()
      setProgress(0)
    }
  }, [audio, audioUrl])

  // Attach ended event listeners if audio is defined
  useEffect(() => {
    if (!audioUrl) {
      return
    }

    audio?.addEventListener("ended", () => {
      setAudioUrl(undefined)
    })

    return () => {
      audio?.removeEventListener("ended", () => setAudioUrl(undefined))
    }
  }, [audio, audioUrl])

  // Update progress
  useEffect(() => {
    if (!audioUrl) {
      return
    }

    const interval = setInterval(() => {
      setProgress(
        (audio?.currentTime /
          (!audio?.duration || Number.isNaN(audio?.duration) ? 1 : audio.duration)) *
          100
      )
    }, 250)

    return () => {
      clearInterval(interval)
      setProgress(0)
    }
  }, [audio, audioUrl])

  return {
    isAnyAudioPlaying: audioUrl !== undefined,
    isPlayingUrl: (url: string) => audioUrl === url,
    getProgress: (currentUrl?: string) => (currentUrl === audioUrl ? progress : 0),
    play: (audioUrl: string) => {
      setAudioUrl(audioUrl)
    },
    stop: () => {
      setAudioUrl(undefined)
    },
    toggle: (currentAudioUrl: string | undefined) => {
      if (currentAudioUrl === audioUrl) {
        setAudioUrl(undefined)
      } else {
        setAudioUrl(currentAudioUrl)
      }
    },
  }
}
