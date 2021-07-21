import Layout from "../components/Layout"
import Link from "next/link"
import { GetStaticProps } from "next"

import { AboutSection } from "../components/AboutSection"
import { getRepository } from "../lib/github"
import { RepositoryCard } from "../components/RepositoryCard"
import type { ExtractReturnedPromiseFn } from "../types"

type HomePageProps = {
  repos: ExtractReturnedPromiseFn<typeof getRepository>[]
}

const HomePage: React.FC<HomePageProps> = ({ repos }) => {
  const Cards = repos.map((r) => <RepositoryCard repo={r} />)

  return (
    <Layout title="Home | Willy Ovalle">
      <main className="flex flex-col flex-grow w-full p-10 mt-10">
        <p>Hi there 👋🏼</p>
        <h1 className="my-4 text-4xl text-title">
          I'm Willy<span className="text-yellow-500">!</span>
        </h1>
        <p>
          Software Developer from 🇩🇴 living in 🇩🇪 who loves{" "}
          <Link href="/about#top-tracks">music</Link>, videogames and to binge watch random YouTube
          videos.
        </p>
        <div className="pt-8"></div>
        <AboutSection title="what i've been working on" subtitle="open source">
          {Cards}
        </AboutSection>
      </main>
    </Layout>
  )
}

export const getStaticProps: GetStaticProps<HomePageProps> = async () => {
  const fireorm = await getRepository({ owner: "wovalle", repo: "fireorm" })

  return {
    props: {
      repos: [fireorm],
    },
    revalidate: 60 * 60 * 24, // Revalidate after 24 hours
  }
}

export default HomePage
