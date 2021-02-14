import { AppProps } from "next/app"
import "../styles/global.scss"
import "@fortawesome/fontawesome-svg-core/styles.css"

const App = ({ Component, pageProps }: AppProps) => {
  return <Component {...pageProps} />
}

export default App
