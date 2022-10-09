import { LuchyNextProvider } from "@luchyio/next"
import { ThemeProvider } from "next-themes"
import { AppProps } from "next/app"
import { ReactNode, useRef, useState } from "react"
import { AudioPlayerContext } from "../hooks/useAudioPlayer"

import "../styles/global.css"

export { reportWebVitals } from "next-axiom"

// TODO: Can we do better?
const baseUrl =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000/api/luchy"
    : "https://willy.im/api/luchy"

export const AudioPlayerProvider = ({ children }: { children: ReactNode }) => {
  const [currentUrl, setCurrentUrl] = useState<string | undefined>()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const intervalRef = useRef<NodeJS.Timer | null>(null)

  return (
    <AudioPlayerContext.Provider value={{ audioRef, intervalRef, currentUrl, setCurrentUrl }}>
      {children}
    </AudioPlayerContext.Provider>
  )
}

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <LuchyNextProvider baseUrl={baseUrl}> 
        <AudioPlayerProvider>
          <Component {...pageProps} />
        </AudioPlayerProvider>
      </LuchyNextProvider>
    </ThemeProvider>
  )
}

export default App
