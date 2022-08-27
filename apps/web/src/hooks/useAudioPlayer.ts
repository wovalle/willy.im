import React, { createContext, useContext, useEffect, useState } from "react"

type AudioPlayerContextProps = {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  intervalRef: React.MutableRefObject<NodeJS.Timer | null>
  currentUrl: string | undefined
  setCurrentUrl: (url: string | undefined) => void
}

export const AudioPlayerContext = createContext<AudioPlayerContextProps | undefined>(undefined)

export const useAudioPlayer = (url: string | undefined) => {
  const audioContext = useContext(AudioPlayerContext)

  if (!audioContext) {
    throw new Error("useAudioPlayer must be used within an AudioPlayerContext")
  }

  const { audioRef, intervalRef, currentUrl, setCurrentUrl } = audioContext
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  // Clear any timers already running
  const startTimer = () => {
    intervalRef.current && clearInterval(intervalRef.current)

    intervalRef.current = setInterval(() => {
      if (audioRef.current && audioRef.current.ended) {
        audioRef.current.currentTime = 0
        setProgress(0)
        setPlaying(false)
      }
      setProgress(audioRef.current ? audioRef.current.currentTime : 0)
    }, 250)
  }

  const pauseAndCleanUp = () => {
    intervalRef.current && clearInterval(intervalRef.current)
    audioRef.current?.pause()
  }

  // Cleanup when we change previews
  useEffect(() => {
    // If is the initial render or the currently playing url is this one, abort
    if (!currentUrl || url === currentUrl) {
      return
    }

    // If the url was changed, reset the component state
    setProgress(0)
    setPlaying(false)
  }, [currentUrl])

  useEffect(() => {
    const urlChanged = url !== currentUrl

    if (playing && url !== currentUrl) {
      pauseAndCleanUp()

      setCurrentUrl(url)
      audioRef.current = new Audio(url)
      setProgress(audioRef.current.currentTime)
    }

    if (playing) {
      audioRef.current?.play()
      startTimer()
    } else {
      // we already clean up before changing the url
      if (urlChanged) {
        return
      }
      pauseAndCleanUp()
    }
  }, [playing])

  // Pause and clean up on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      intervalRef.current && clearInterval(intervalRef.current)
    }
  }, [])

  return {
    playing,
    toggle: () => {
      setPlaying((p) => !p)
    },
    progress: audioRef.current ? (progress / audioRef.current.duration || 0) * 100 : 0,
  }
}
