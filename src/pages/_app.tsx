import "../styles/global.css"

import { AppProps } from "next/app"
import { ThemeProvider } from "next-themes"

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <Component {...pageProps} />
    </ThemeProvider>
  )
}

export default App
