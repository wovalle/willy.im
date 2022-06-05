import { IconArrowUpRight, IconBrandTwitter } from "@tabler/icons"
import { GetStaticProps } from "next"
import Image from "next/image"
import Link from "next/link"
import Layout from "../components/layouts/Default"
import { PageSection } from "../components/PageSection"
import { RepositoryCard } from "../components/RepositoryCard"
import { getRepositories, SimpleRepository } from "../lib/github"

type HomePageProps = {
  repos: SimpleRepository[]
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

const HomePage: React.FC<HomePageProps> = ({ repos }) => {
  const RepoCards = repos.map((r) => <RepositoryCard key={r.url} repo={r} />)

  return (
    <Layout title="Home">
      <main className="flex flex-grow flex-col gap-32 py-16 px-6">
        <section id="hero" className="grid md:grid-cols-5">
          <div className="text-subtitle col-span-4 mr-4 flex flex-col gap-4">
            <p>
              Hi there <span className="wave">👋🏼</span>
            </p>
            <h1 className="text-title text-4xl">I'm Willy!</h1>
            <p className="text-xl">
              Dominican Software Developer who loves <Link href="/about#songs">music</Link>,
              videogames and spends too much time watching youtube videos. Say hello at
              <Link
                href="https://twitter.com/wovalle"
                className="ml-2 inline-flex items-center gap-1"
              >
                @wovalle
                <IconBrandTwitter size="1em" />
              </Link>
              !
            </p>
            <p className="flex">
              <Link
                href="/about"
                className="flex items-center justify-center gap-1 rounded-xl border-0 bg-prim-700  px-4 py-3 font-bold text-white hover:bg-prim-900 dark:bg-prim-900 dark:hover:bg-prim-700"
              >
                about me <IconArrowUpRight size="1em" />
              </Link>
            </p>
          </div>
          <Image
            src="/profile.png"
            width={296}
            height={296}
            className="opacity-85 hidden rounded-full object-cover dark:contrast-75"
          />
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

export default HomePage
