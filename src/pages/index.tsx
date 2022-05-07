import { GetStaticProps } from "next"
import Link from "next/link"
import Layout from "../components/Layout"
import Logo from "../components/Logo"
import { PageSection } from "../components/PageSection"
import { RepositoryCard } from "../components/RepositoryCard"
import { getRepositories, getRepository } from "../lib/github"
import type { ExtractReturnedPromiseFn } from "../types"

type HomePageProps = {
  repos: ExtractReturnedPromiseFn<typeof getRepository>[]
}

const HomePage: React.FC<HomePageProps> = ({ repos }) => {
  const RepoCards = repos.map((r) => <RepositoryCard key={r.url} repo={r} />)

  return (
    <Layout title="Home | Willy Ovalle" withFooterDivider>
      <main className="flex flex-col gap-20 p-10">
        <section id="hero" className="grid md:grid-cols-5">
          <div className="text-subtitle col-span-4 space-y-6">
            <p>
              Hi there <span className="wave">👋🏼</span>
            </p>
            <h1 className="text-title text-4xl">I'm Willy!</h1>
            <p className="text-xl">
              Dominican Software Developer who loves <Link href="/about#songs">music</Link>,
              videogames and to binge watch random YouTube videos. Say hello at hi[at]willy.im!
            </p>
          </div>
          <Logo width={200} height={200} className="hidden md:block " />
        </section>

        <PageSection
          title="what i've been working on"
          subtitle="open source projects"
          id="code"
          className="bg-neuli-500/60 dark:bg-neuda-700"
          bleed
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{RepoCards}</div>
        </PageSection>
      </main>
    </Layout>
  )
}

export const getStaticProps: GetStaticProps<HomePageProps> = async () => {
  const repos = await getRepositories({ username: "wovalle" })

  return {
    props: {
      repos,
    },
    revalidate: 60 * 60 * 24, // Revalidate after 24 hours
  }
}

export default HomePage
