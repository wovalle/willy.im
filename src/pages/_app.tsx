import { ThemeProvider } from "next-themes"
import { AppProps } from "next/app"
import { ReactNode, useRef, useState } from "react"
import { AudioPlayerContext } from "../hooks/useAudioPlayer"
import "../styles/global.css"

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
      <AudioPlayerProvider>
        <Component {...pageProps} />
      </AudioPlayerProvider>
    </ThemeProvider>
  )
}

export default App
