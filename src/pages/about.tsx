import type { GetStaticProps } from "next"

import { MarkdownContent } from "../components/MarkdownContent"
import { AboutSection } from "../components/AboutSection"
import { AboutListElement } from "../components/AboutListElement"
import Layout from "../components/Layout"

import { getCurrentlyReading, getReviews } from "../lib/goodreads"
import { toHtml } from "../lib/markdown"
import { getTopTracks } from "../lib/spotify"
import { markdownBio } from "../lib/static"
import { FaBook, FaBookOpen, FaMusic, FaStar } from "react-icons/fa"

export type AboutProps = {
  bio: string
  topTracks: Awaited<ReturnType<typeof getTopTracks>>
  reviews: Awaited<ReturnType<typeof getReviews>>
  currentlyReading: Awaited<ReturnType<typeof getReviews>>
}

const AboutPage: React.FC<AboutProps> = ({ bio, topTracks, reviews, currentlyReading }) => {
  const topTracksList = topTracks.map((t, i) => (
    <AboutListElement
      key={t.url}
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      leftPanel={<span className="text-xs font-bold text-subtitle">{i + 1}</span>}
    />
  ))

  const reviewList = reviews.map((r) => (
    <AboutListElement
      key={r.url}
      title={r.title}
      subtitle={r.author}
      url={r.url}
      leftPanel={
        <div className="flex text-xs font-bold leading-6 text-subtitle items-center">
          {r.rating} <FaStar className="text-yellow-500 ml-1" />
        </div>
      }
    />
  ))

  const currentlyReadingList = currentlyReading.map((r) => (
    <AboutListElement key={r.url} title={r.title} subtitle={r.author} url={r.url} />
  ))

  return (
    <Layout title="About | Willy Ovalle">
      <main className="flex flex-col flex-grow p-8 md:p-10">
        <AboutSection id="bio" title="who i am">
          <MarkdownContent content={bio} />
        </AboutSection>

        <AboutSection
          id="songs"
          title="what i've been jamming to"
          Icon={FaMusic}
          subtitle={
            <>
              in the last few weeks.
              <a href="/playlist" className="ml-1">
                here
              </a>
              's a playlist to know me better
            </>
          }
        >
          <div className="grid grid-cols-1 md:gap-4 md:grid-cols-2">
            <ul>{topTracksList.slice(0, 5)}</ul>
            <ul>{topTracksList.slice(5, 10)}</ul>
          </div>
        </AboutSection>

        <AboutSection id="books" title="currently into..." Icon={FaBookOpen}>
          <div className="grid grid-cols-1 md:gap-4 md:grid-cols-2">
            <ul>{currentlyReadingList}</ul>
          </div>
        </AboutSection>

        <AboutSection
          id="books"
          title="what i've been reading"
          subtitle="or listening, whatever, love audiobooks"
          Icon={FaBook}
        >
          <div className="grid grid-cols-1 md:gap-4 md:grid-cols-2">
            <ul>{reviewList.slice(0, 5)}</ul>
            <ul>{reviewList.slice(5, 10)}</ul>
          </div>
        </AboutSection>

        {/* 
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
  const currentlyReading = await getCurrentlyReading({ limit: 2 })

  return {
    props: {
      bio,
      topTracks,
      reviews,
      currentlyReading,
    },
    revalidate: 60 * 60 * 1, // Revalidate after 1 hour
  }
}

export default AboutPage
