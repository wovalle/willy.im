import { IconBrandSpotify, IconStar } from "@tabler/icons"
import type { GetStaticProps } from "next"
import Link from "next/link"
import { useState } from "react"
import { PlayButtonOverlay } from "../components/about/PlayButtonOverlay"
import { AboutListElement } from "../components/AboutListElement"
import Layout from "../components/Layout"
import { MarkdownContent } from "../components/MarkdownContent"
import { PageSection } from "../components/PageSection"
import { InlineSelect } from "../components/Select"
import { getCurrentlyReading, getReviews } from "../lib/goodreads"
import { toHtml } from "../lib/markdown"
import { getTopTracks, ValidTimeframe } from "../lib/spotify"
import { markdownBio } from "../lib/static"

export type AboutProps = {
  bio: string
  topTracks: Awaited<ReturnType<typeof getTopTracks>>
  reviews: Awaited<ReturnType<typeof getReviews>>
  currentlyReading: Awaited<ReturnType<typeof getReviews>>
}

// TODO: create runtime union validator for Timeframe

const AboutPage: React.FC<AboutProps> = ({ bio, topTracks, reviews, currentlyReading }) => {
  const options = ["days", "months", "years"].map((t) => ({ value: t, label: t }))
  const [timeframe, setTimeframe] = useState(options[0].value as ValidTimeframe)

  const topTracksList = topTracks[timeframe].map((t) => (
    <AboutListElement
      key={t.songName}
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      leftPanel={
        t.thumbnailUrl ? (
          <PlayButtonOverlay audioUrl={t.previewUrl} diameter={60}>
            <img
              style={{ maxHeight: 60, maxWidth: 60 }}
              src={t.thumbnailUrl}
              alt={t.songName}
              className="rounded-xl"
            />
          </PlayButtonOverlay>
        ) : null
      }
    />
  ))

  const reviewList = reviews.map((r) => (
    <AboutListElement
      key={r.url}
      title={r.title}
      subtitle={r.author}
      url={r.url}
      leftPanel={
        <div className="text-subtitle flex items-center self-start text-xs font-bold leading-6">
          {r.rating} <IconStar size="1.2em" className="ml-1 text-yellow-500" />
        </div>
      }
    />
  ))

  const currentlyReadingList = currentlyReading.map((r) => (
    <AboutListElement key={r.url} title={r.title} subtitle={<>{r.author}</>} url={r.url} />
  ))

  return (
    <Layout title="About | Willy Ovalle">
      <main className="flex flex-grow flex-col p-8 md:p-10">
        <PageSection id="bio" title="who i am" bodyClassName="leading-relaxed text-lg">
          <MarkdownContent content={bio} />
        </PageSection>

        <PageSection
          id="songs"
          title="what i've been jamming to"
          bleed
          subtitle={
            <>
              in the last few{" "}
              <InlineSelect
                options={options}
                onChange={(v) => setTimeframe(v as ValidTimeframe)}
                selected={timeframe}
              />
              . want to know me better?
              <Link href="/playlist" className="ml-1">
                have fun
              </Link>
            </>
          }
        >
          <div className="absolute right-20 top-14">
            <IconBrandSpotify size="3em" color="#1ED760" />
          </div>

          <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-4">{topTracksList}</ul>
        </PageSection>

        <PageSection
          id="books"
          title="what i've been reading"
          subtitle="or listening, whatever, love audiobooks"
          bodyClassName="grid gap-4"
        >
          <div className="grid gap-1 rounded-xl">
            <span className="w-32 rounded bg-blue-100 px-2 py-1 text-center text-xs font-bold text-blue-800 dark:bg-blue-200 dark:text-blue-800">
              currently reading
            </span>
            <ul className="grid grid-cols-1 md:grid-cols-2 md:gap-4">{currentlyReadingList}</ul>
          </div>
          <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-4 ">{reviewList}</ul>
        </PageSection>

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
  const [bio, topTracks, reviews, currentlyReading] = await Promise.all([
    toHtml(markdownBio),
    getTopTracks({ limit: 10 }),
    getReviews({ limit: 10, trimTitle: true }),
    getCurrentlyReading({ limit: 2, trimTitle: true }),
  ])

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
