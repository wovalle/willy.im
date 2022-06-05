import Layout from "../components/layouts/Default"

const Custom500 = () => {
  return (
    <Layout title="500 | Willy Ovalle" withFooterDivider={false}>
      <div className="flex flex-grow flex-col items-center justify-center">
        <div className="text-title text-4xl">oops... 500</div>
        <div className="text-subtitle">i probably messed up mate</div>
      </div>
    </Layout>
  )
}

export default Custom500
