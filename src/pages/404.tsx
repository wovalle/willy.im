import Layout from "../components/Layout"

const Custom404 = () => {
  return (
    <Layout title="404 | Willy Ovalle" withFooterDivider={false}>
      <div className="flex flex-col items-center">
        <div className="text-4xl text-title">oops... 404</div>
        <div className="text-subtitle">you probably messed up mate</div>
      </div>
    </Layout>
  )
}

export default Custom404
