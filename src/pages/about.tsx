import type { GetStaticProps } from "next"
import { FaSpotify } from "react-icons/fa"

import { MarkdownContent } from "../components/MarkdownContent"
import { AboutSection } from "../components/AboutSection"
import { AboutListElement } from "../components/AboutListElement"
import Layout from "../components/Layout"

import { getReviews } from "../lib/goodreads"
import { toHtml } from "../lib/markdown"
import { getTopTracks } from "../lib/spotify"
import { markdownBio } from "../lib/static"
import type { PromiseValue } from "../types"

export type AboutProps = {
  bio: string
  topTracks: PromiseValue<ReturnType<typeof getTopTracks>>
  reviews: PromiseValue<ReturnType<typeof getReviews>>
}

const AboutPage: React.FC<AboutProps> = ({ bio, topTracks, reviews }) => {
  const topTracksList = topTracks.map((t, i) => (
    <AboutListElement
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      id={t.url}
      leftPanel={<span className="text-xs font-bold text-subtitle">{i + 1}</span>}
    />
  ))

  const reviewList = reviews.map((r) => (
    <AboutListElement
      title={r.title}
      subtitle={r.author || ""}
      url={r.url}
      id={r.id}
      titleSide={
        <span className="flex items-center pl-2 text-xs font-bold text-subtitle">
          {r.rating} ⭐️
        </span>
      }
    />
  ))

  return (
    <Layout title="About | Willy Ovalle">
      <main className="flex flex-col flex-grow p-10">
        <AboutSection id="bio" title="who i am">
          <MarkdownContent content={bio} />
        </AboutSection>

        <AboutSection
          id="top-tracks"
          title="what i've been jamming to"
          subtitle={
            <span className="flex items-center">
              <FaSpotify size="0.9em" className="pr-1" />
              in the last few weeks.
              <a href="/playlist" className="pl-1">
                here
              </a>
              's a playlist to know me better
            </span>
          }
        >
          <ul>{topTracksList}</ul>
        </AboutSection>

        <AboutSection
          id="book-reviews"
          title="what i've been reading"
          subtitle="or listening, whatever, love audiobooks"
        >
          <ul>{reviewList}</ul>
        </AboutSection>

        {/* <AboutSection title="what i've been working on">
          <span>eventually i'll plug my github data here</span>
        </AboutSection>

        <AboutSection title="what i've been watching">
          <span>eventually i'll plug my youtube data here</span>
        </AboutSection>

        <AboutSection title="what i've been doing">
          <span>eventually i'll plug my timeline data here</span>
        </AboutSection>

        <AboutSection title="what i've been visiting">
          <span>eventually i'll put a map with countries i've visited here</span>
        </AboutSection> */}
      </main>
    </Layout>
  )
}

export const getStaticProps: GetStaticProps<AboutProps> = async () => {
  const bio = await toHtml(markdownBio)
  const topTracks = await getTopTracks({ limit: 10 })
  const reviews = await getReviews({ limit: 10 })

  return {
    props: {
      bio,
      topTracks,
      reviews,
    },
    revalidate: 60 * 60 * 24, // Revalidate after 24 hours
  }
}

export default AboutPage
