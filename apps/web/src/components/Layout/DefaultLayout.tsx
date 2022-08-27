import Head from "next/head"
import { FunctionComponent, ReactNode } from "react"
import Footer from "../Footer"
import { Header } from "../Header"

type LayoutProps = {
  children?: ReactNode
  title?: string
  withFooterDivider?: boolean
}

export const DefaultLayout: FunctionComponent<LayoutProps> = ({
  children,
  title = "",
  withFooterDivider,
}) => (
  <>
    {title && (
      <Head>
        <title>{`${title} | Willy Ovalle`}</title>
      </Head>
    )}
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col overflow-hidden text-gray-700 dark:text-gray-200">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Header />
      {children}
      <Footer withFooterDivider={withFooterDivider} />
    </div>
  </>
)
