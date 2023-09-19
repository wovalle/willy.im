"use client"

import { LuchyNextAppProvider } from "@luchyio/next"
import { ThemeProvider } from "next-themes"
import { FC, ReactNode, useState } from "react"
import { AudioPlayerContext } from "./about/components/AudioPlayerContext"

type ProvidersProps = {
  children: ReactNode
}

const Providers: FC<ProvidersProps> = ({ children }) => {
  const [audioUrl, setAudioUrl] = useState<string | undefined>()

  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <LuchyNextAppProvider>
        <AudioPlayerContext.Provider value={{ audioUrl, setAudioUrl }}>
          {children}
        </AudioPlayerContext.Provider>
      </LuchyNextAppProvider>
    </ThemeProvider>
  )
}

export { Providers }
