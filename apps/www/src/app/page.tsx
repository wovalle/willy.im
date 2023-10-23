import { IconArrowUpRight, IconBrandTwitter } from "@tabler/icons-react"
import { allPosts } from "contentlayer/generated"
import Image from "next/image"
import Link from "next/link"
import { getRepositories } from "../lib/github"
import { PageSection } from "./components/PageSection"
import { RepositoryCard } from "./components/RepositoryCard"
import { Time } from "./components/Time"

const PostCard: React.FC<{
  url: string
  publishedAt: string | null
  title: string
  summary: string
}> = ({ url, publishedAt, title, summary }) => (
  <article className="justify flex flex-col content-between  py-4">
    {publishedAt ? (
      <Time
        className="text-subtitle text-xs font-thin leading-tight"
        date={publishedAt}
        format="MMMM D, YYYY"
      />
    ) : null}
    <div>
      <Link href={url} className="border-transparent text-xl font-bold" rel="noopener noreferrer">
        {title}
      </Link>
    </div>
    <div className="text-subtitle text-neuda-100-300">{summary}</div>
  </article>
)

export default async function Home() {
  // TODO: revalidate each 24h
  const repos = await getRepositories({ username: "wovalle" })
  const RepoCards = repos.map((r) => <RepositoryCard key={r.url} repo={r} />)

  const PostCards = allPosts.map((p) => (
    <PostCard
      key={p._id}
      url={p.path}
      publishedAt={p.published}
      title={p.title}
      summary={p.summary}
    />
  ))

  return (
    <main className="flex flex-grow flex-col gap-24 py-16 px-6">
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
              className="flex items-center justify-center gap-1 rounded-xl border-0 bg-prim-700 px-4 py-3 font-bold text-white decoration-transparent hover:bg-prim-900 hover:text-gray-50 hover:decoration-transparent dark:bg-prim-900 dark:hover:bg-prim-700"
              data-luchy-event="cta-click"
            >
              about me <IconArrowUpRight size="1em" />
            </Link>
          </p>
        </div>
        <div className="image-container hidden md:block">
          <Image
            alt="Willy Ovalle's profile picture"
            src="/profile.png"
            width={296}
            height={296}
            className="opacity-85 rounded-full object-cover dark:contrast-75"
          />
        </div>
      </section>

      <PageSection
        title="what i've been writing"
        id="posts"
        bleed
        className="bg-neuli-500/60 dark:bg-neuda-700"
      >
        <div className="grid grid-cols-1 gap-2">{PostCards}</div>
      </PageSection>

      <PageSection title="what i've been working on" subtitle="open source projects" id="code">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{RepoCards}</div>
      </PageSection>
    </main>
  )
}

// Revalidate every hour
export const revalidate = 3600
