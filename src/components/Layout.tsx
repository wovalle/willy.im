import React, { ReactNode } from "react"
import Head from "next/head"
import Header from "./Header"
import Footer from "./Footer"

type Props = {
  children?: ReactNode
  title?: string
}

const Layout: React.FC<Props> = ({ children, title }) => (
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
      <Footer />
    </div>
  </>
)

export default Layout
