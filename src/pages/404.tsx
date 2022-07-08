import { DefaultLayout } from "../components/Layout"

const Custom404 = () => {
  return (
    <DefaultLayout title="404 | Willy Ovalle" withFooterDivider={false}>
      <main className="flex flex-grow flex-col items-center justify-center">
        <div className="text-title text-4xl">oops... 404</div>
        <div className="text-subtitle">you probably messed up mate</div>
      </main>
    </DefaultLayout>
  )
}

export default Custom404
