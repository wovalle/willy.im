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
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
    )}
    <div className="flex flex-col justify-between min-h-screen text-gray-700 dark:text-gray-200">
      <Header />
      {children}
      <Footer />
    </div>
  </>
)

export default Layout
