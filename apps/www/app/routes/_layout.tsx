import { Outlet, useRouteLoaderData } from "react-router"
import { Footer } from "~/components/layout/footer"
import { Header } from "~/components/layout/header"
import type { loader } from "~/root"

export default function Layout() {
  const rootLoaderData = useRouteLoaderData<typeof loader>("root")

  return (
    <>
      <Header />
      <main className="flex w-full max-w-4xl flex-grow self-center">
        <Outlet />
      </main>
      <Footer nowPlaying={rootLoaderData?.nowPlaying} />
    </>
  )
}

