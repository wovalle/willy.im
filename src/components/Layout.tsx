import { ReactNode, FunctionComponent } from "react"
import Head from "next/head"
import Header from "./Header"
import Footer from "./Footer"

type Props = {
  children?: ReactNode
  title?: string
  withFooterDivider?: boolean
}

const Layout: FunctionComponent<Props> = ({ children, title, withFooterDivider }) => (
  <>
    {title && (
      <Head>
        <title>{title}</title>
      </Head>
    )}
    <div className="flex flex-col justify-between w-full max-w-4xl min-h-screen mx-auto text-gray-700 dark:text-gray-200">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Header />
      {children}
      {/* footer a bit more dark (see ) */}
      <Footer withFooterDivider={withFooterDivider} />
    </div>
  </>
)

export default Layout
