import Layout from "../components/Layout"

const Custom500 = () => {
  return (
    <Layout title="404 | Willy Ovalle" withFooterDivider={false}>
      <div className="flex flex-col items-center">
        <div className="text-4xl text-title">oops... 500</div>
        <div className="text-subtitle">i probably messed up mate</div>
      </div>
    </Layout>
  )
}

export default Custom500
