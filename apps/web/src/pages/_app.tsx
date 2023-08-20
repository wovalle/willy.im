import { ThemeProvider } from "next-themes"
import { AppProps } from "next/app"

import { LuchyNextProvider } from "@luchyio/next"
import "../styles/global.css"

export { reportWebVitals } from "next-axiom"

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      {/* TODO: defaults */}
      <LuchyNextProvider baseUrl={"/api/luchy"}>
        <Component {...pageProps} />
      </LuchyNextProvider>
    </ThemeProvider>
  )
}

export default App
