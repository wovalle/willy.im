import Layout from "../components/layouts/Default"

const Custom404 = () => {
  return (
    <Layout title="404 | Willy Ovalle" withFooterDivider={false}>
      <main className="flex flex-grow flex-col items-center justify-center">
        <div className="text-title text-4xl">oops... 404</div>
        <div className="text-subtitle">you probably messed up mate</div>
      </main>
    </Layout>
  )
}

export default Custom404
