import Layout from "../components/Layout"
import Link from "next/link"

const playlistLink =
  "https://open.spotify.com/playlist/2DTIGceTBxntcToaVl0lxR?si=M5aF2T7OQjCyO2lS2wxMzw"

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

        {/* <section className="mt-5">
          <h1> what i've been working on</h1>
          <h2>fireorm</h2>
        </section>

        <section className="mt-5">
          <h1>what ive been doing</h1>
          <h2>timeline</h2>
        </section>


        <section className="mt-5">
          <h1> what i've been jamming to</h1>
        </section>

        <section className="mt-5">
          <h1> what i've been watching</h1>
        </section> 
        
        <section className="mt-5">
          <h1> what ive been visiting</h1>
        </section>
        */}
      </main>
    </Layout>
  )
}

export default HomePage
