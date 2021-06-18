import Layout from "../components/Layout"

const HomePage = () => {
  return (
    <Layout title="About | Willy Ovalle">
      <main className="flex flex-col flex-grow p-10 mt-10">
        <section>
          <h1> photo and minibio</h1>
        </section>

        <section className="mt-5">
          <h1 className="font-bold"> what i've been working on</h1>
          <h2>fireorm</h2>
        </section>

        <section className="mt-5">
          <h1> what i've been jamming to</h1>
        </section>

        <section className="mt-5">
          <h1> what i've been watching</h1>
        </section>

        <section className="mt-5">
          <h1>what ive been doing</h1>
          <h2>timeline</h2>
        </section>

        <section className="mt-5">
          <h1> what ive been visiting</h1>
        </section>
      </main>
    </Layout>
  )
}

export default HomePage
