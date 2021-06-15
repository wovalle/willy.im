import React, { ReactNode } from "react"
import Head from "next/head"

type Props = {
  children?: ReactNode
  title?: string
}

const Layout: React.FC<Props> = ({ children, title = "Willy Ovalle" }) => (
  <div>
    <Head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <title>{title}</title>
      <meta name="keywords" content="willy,ovalle,wovalle,personal,site" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta property="og:image" content="/android-chrome-512x512.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-16x16.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-32x32.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <meta name="yandex-verification" content="6ef5628ffe37d921" />
    </Head>
    {children}
  </div>
)

export default Layout
