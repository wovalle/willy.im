import Layout from "../components/Layout"
import Link from "next/link"

const HomePage = () => {
  return (
    <Layout title="Home | Willy Ovalle">
      <main className="flex flex-col flex-grow w-full p-10 mt-10">
        <p>Hi there 👋🏼</p>
        <h1 className="my-4 text-4xl font-bold">
          I'm Willy<span className="text-yellow-500">!</span>
        </h1>

        <p>
          Software Developer from 🇩🇴 living in 🇸🇪 who loves{" "}
          <Link href="/about#top-tracks">music</Link>, videogames and to binge watch random youtube
          videos.
        </p>
      </main>
    </Layout>
  )
}

export default HomePage
