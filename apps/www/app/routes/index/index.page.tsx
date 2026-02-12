import { IconArrowUpRight, IconBrandTwitter } from "@tabler/icons-react"
import { allPosts } from "content-collections"
import { Link } from "react-router"
import type { Route } from "./+types/index.page"

import { PageSection } from "~/components/layout/page-section"
import type { SimpleRepository } from "~/modules/github/github.types"
import { createPageMeta, siteConfig } from "~/static"
import { PostCard } from "./post-card"
import { RepositoryCard } from "./repository-card"

export const meta: Route.MetaFunction = () => {
  return [
    ...createPageMeta({
      title: siteConfig.title,
      description: siteConfig.description,
      path: "/",
    }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteConfig.title,
        description: siteConfig.description,
        url: siteConfig.url,
        author: {
          "@type": "Person",
          name: siteConfig.author,
        },
      },
    },
  ]
}

export const loader = async ({ context }: Route.LoaderArgs) => {
  const posts = allPosts.slice(0, 2)

  const githubData = await context.services.github.getFromCache()

  return {
    featuredPosts: posts,
    repos: githubData.repositories.slice(0, 4),
  }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { featuredPosts, repos } = loaderData

  const RepoCards = repos.map((r: SimpleRepository) => <RepositoryCard key={r.url} repo={r} />)

  const PostCards = featuredPosts.map((p: any) => (
    <PostCard
      key={p._meta.path}
      url={`/posts/${p._meta.path}`}
      publishedAt={p.publishedAt}
      title={p.title}
      summary={p.summary}
    />
  ))

  return (
    <article className="flex flex-grow flex-col gap-24 px-6 py-16">
      <section id="hero" className="grid md:grid-cols-5">
        <div className="text-gray-500 dark:text-gray-400 col-span-4 mr-4 flex flex-col gap-4">
          <p>
            Hi there <span className="wave">👋🏼</span>
          </p>
          <h1 className="text-gray-800 dark:text-gray-50 text-4xl">I'm Willy!</h1>
          <p className="text-xl">
            Dominican Software Developer who loves <Link to="/about#songs">music</Link>, videogames
            and spends too much time watching youtube videos. I build web applications with React,
            TypeScript, and Cloudflare Workers. Say hello at
            <Link
              to="https://twitter.com/wovalle"
              className="ml-2 inline-flex items-center gap-1"
              rel="noopener noreferrer"
              target="_blank"
            >
              Twitter (wovalle)
              <IconBrandTwitter size="1em" aria-hidden />
            </Link>
            !
          </p>
          <p className="flex">
            <Link
              to="/about"
              className="flex items-center justify-center gap-1 rounded-xl border-0 bg-stone-600 px-4 py-3 font-bold text-white decoration-transparent hover:bg-stone-700 hover:text-gray-50 hover:decoration-transparent dark:bg-stone-700 dark:hover:bg-stone-600"
              data-luchy-event="cta-click"
            >
              Learn more about me <IconArrowUpRight size="1em" aria-hidden />
            </Link>
          </p>
        </div>
        <div className="image-container hidden md:block">
          <img
            alt="Willy Ovalle's profile picture"
            src="/profile.png"
            width={296}
            height={296}
            fetchPriority="high"
            className="rounded-full object-cover opacity-85 dark:contrast-75"
          />
        </div>
      </section>

      <PageSection
        title="what i've been writing"
        id="posts"
        bleed={true}
        className="bg-stone-200/80 dark:bg-stone-700"
      >
        <div className="grid grid-cols-1 gap-2">{PostCards}</div>
      </PageSection>

      <PageSection title="what i've been working on" subtitle="open source projects" id="code">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{RepoCards}</div>
      </PageSection>
    </article>
  )
}
