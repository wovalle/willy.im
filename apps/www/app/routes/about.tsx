import { allSingletons } from "content-collections"
import invariant from "tiny-invariant"
import type { Route } from "./+types/about"
import { createPageMeta, siteConfig } from "~/static"
import { BooksSection } from "./about/books-section"
import { TopTracksAndArtistsSection } from "./about/top-tracks-and-artists-section"
import { VideosSection } from "./about/videos-section"

export const meta: Route.MetaFunction = () =>
  createPageMeta({
    title: `About | ${siteConfig.author}`,
    description: `Learn more about Willy Ovalle - software developer, music lover, and open source enthusiast based in Santo Domingo.`,
    path: "/about",
  })

export const loader = async ({ context }: Route.LoaderArgs) => {
  const bio = allSingletons.find((singleton) => singleton.name === "bio")
  invariant(bio, "Bio markdown not found")

  const [youtube, spotify, goodreads] = await Promise.all([
    context.services.youtube.getFromCache(),
    context.services.spotify.getFromCache(),
    context.services.goodreads.getFromCache(),
  ])

  return {
    bio,
    youtube,
    spotify,
    goodreads,
  }
}

export default function AboutPage({ loaderData }: Route.ComponentProps) {
  const { bio, youtube, spotify, goodreads } = loaderData

  return (
    <article className="flex flex-grow flex-col gap-24 px-6 py-10">
      <section id="bio" className="relative rounded-xl">
        <div className="flex flex-col gap-4">
          <h2 className="text-3xl font-bold">who i am</h2>
          <div
            className="markdown flex flex-col gap-4 text-lg leading-relaxed"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown
            dangerouslySetInnerHTML={{ __html: bio?.md }}
          />
        </div>
      </section>

      <TopTracksAndArtistsSection topTracks={spotify.topTracks} topArtists={spotify.topArtists} />

      <VideosSection videos={youtube.videos} />

      <BooksSection currentlyReading={goodreads.currentlyReading} reviews={goodreads.reviews} />
    </article>
  )
}
