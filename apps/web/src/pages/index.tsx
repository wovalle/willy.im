import { IconArrowUpRight, IconBrandTwitter } from "@tabler/icons"
import { InferGetStaticPropsType } from "next"
import Image from "next/image"
import Link from "next/link"
import { Time } from "../components/Core/Time"
import { DefaultLayout } from "../components/Layout"
import { PageSection } from "../components/PageSection"
import { RepositoryCard } from "../components/RepositoryCard"
import { getRepositories } from "../lib/github"
import { getPublicPosts } from "../lib/notion"

export const getStaticProps = async () => {
  const repos = await getRepositories({ username: "wovalle" })
  const posts = await getPublicPosts(3)

  return {
    props: {
      repos,
      posts: posts,
    },
    revalidate: 60 * 60 * 24, // Revalidate after 24 hours
  }
}

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

const HomePage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = ({ repos, posts }) => {
  const RepoCards = repos.map((r) => <RepositoryCard key={r.url} repo={r} />)
  const PostCards = posts.map((p) => (
    <PostCard
      key={p.slug}
      url={`/posts/${p.slug}`}
      publishedAt={p.publishedAt}
      title={p.title}
      summary={p.summary}
    />
  ))

  return (
    <DefaultLayout title="Home">
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
                className="flex items-center justify-center gap-1 rounded-xl border-0 bg-prim-700  px-4 py-3 font-bold text-white hover:bg-prim-900 dark:bg-prim-900 dark:hover:bg-prim-700"
                data-luchy-event="cta-click"
              >
                about me <IconArrowUpRight size="1em" />
              </Link>
            </p>
          </div>
          <div className="image-container hidden md:block">
            <Image
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
          <div className="grid grid-cols-1 gap-4">{PostCards}</div>
        </PageSection>

        <PageSection title="what i've been working on" subtitle="open source projects" id="code">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{RepoCards}</div>
        </PageSection>
      </main>
    </DefaultLayout>
  )
}

export default HomePage
