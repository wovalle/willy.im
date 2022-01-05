import Layout from "../components/Layout"
import Link from "next/link"
import { GetStaticProps } from "next"

import { AboutSection } from "../components/AboutSection"
import { getRepository } from "../lib/github"
import { RepositoryCard } from "../components/RepositoryCard"
import type { ExtractReturnedPromiseFn } from "../types"
import { FaGithub } from "react-icons/fa"

type HomePageProps = {
  repos: ExtractReturnedPromiseFn<typeof getRepository>[]
}

const HomePage: React.FC<HomePageProps> = ({ repos }) => {
  const RepoCards = repos.map((r) => <RepositoryCard key={r.url} repo={r} />)

  return (
    <Layout title="Home | Willy Ovalle">
      <main className="flex flex-col flex-grow w-full p-10 mt-10">
        <p>Hi there 👋🏼</p>
        <h1 className="my-4 text-4xl text-title">
          I'm Willy<span className="text-highlight">!</span>
        </h1>
        <p>
          Software Developer from 🇩🇴 living in 🇩🇪 who loves <Link href="/about#songs">music</Link>,
          videogames and to binge watch random YouTube videos.
        </p>
        <div className="pt-8"></div>
        <AboutSection
          title="what i've been working on"
          subtitle="open source"
          id="code"
          Icon={FaGithub}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{RepoCards}</div>
        </AboutSection>
      </main>
    </Layout>
  )
}

export const getStaticProps: GetStaticProps<HomePageProps> = async () => {
  const fireorm = await getRepository({ owner: "wovalle", repo: "fireorm" })
  const angelos = await getRepository({ owner: "wovalle", repo: "angelos" })

  return {
    props: {
      repos: [fireorm, angelos],
    },
    revalidate: 60 * 60 * 24, // Revalidate after 24 hours
  }
}

export default HomePage
