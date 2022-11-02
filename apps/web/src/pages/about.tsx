import { IconBrandSpotify, IconStar } from "@tabler/icons"
import { allGlobals } from "contentlayer/generated"
import type { InferGetStaticPropsType, NextPage } from "next"
import { useMDXComponent } from "next-contentlayer/hooks"
import { useState } from "react"
import { AboutListElement, PlayButtonOverlay } from "../components/About"
import { InlineSelect } from "../components/Core"
import { DefaultLayout } from "../components/Layout"
import { PageSection } from "../components/PageSection"
import { getCurrentlyReading, getReviews } from "../lib/goodreads"
import { getTopTracks, ValidTimeframe } from "../lib/spotify"

// TODO: create runtime union validator for Timeframe
const AboutPage: NextPage<InferGetStaticPropsType<typeof getStaticProps>> = ({
  bio,
  topTracks,
  reviews,
  currentlyReading,
}) => {
  const options = ["days", "months", "years"].map((t) => ({ value: t, label: t }))
  const [timeframe, setTimeframe] = useState(options[0].value as ValidTimeframe)

  const topTracksList = topTracks[timeframe].map((t) => (
    <AboutListElement
      key={t.url}
      title={t.songName}
      subtitle={t.artistName}
      url={t.url}
      leftPanel={(isHovered) =>
        t.thumbnailUrl ? (
          <PlayButtonOverlay audioUrl={t.previewUrl} diameter={60} isHovered={isHovered}>
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
      withHover={false}
      leftPanel={() => (
        <div className="text-subtitle flex items-center self-start text-xs font-bold leading-6">
          {r.rating} <IconStar size="1.2em" className="ml-1 text-yellow-500" />
        </div>
      )}
    />
  ))

  const currentlyReadingList = currentlyReading.map((r) => (
    <AboutListElement
      key={r.url}
      title={r.title}
      subtitle={<>{r.author}</>}
      withHover={false}
      url={r.url}
    />
  ))

  const Bio = useMDXComponent(bio.code)

  return (
    <DefaultLayout title="About">
      <main className="flex flex-grow flex-col py-10 px-6">
        <PageSection
          id="bio"
          title="who i am"
          bodyClassName="leading-relaxed text-lg gap-4 flex flex-col markdown"
        >
          <Bio />
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
            </>
          }
        >
          <div className="absolute right-6 md:right-20 md:top-14">
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
          <fieldset className="relative grid rounded-xl border-2 border-dashed border-neuda bg-slate-50 p-4 dark:bg-slate-900/70">
            <legend className="ml-4">
              <strong className="w-32 rounded bg-neuli px-2 py-1 text-center text-xs font-bold text-neuda dark:bg-neuda dark:text-neuli">
                currently reading
              </strong>
            </legend>
            <ul className="grid grid-cols-1 md:grid-cols-2 md:gap-4">{currentlyReadingList}</ul>
          </fieldset>
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
    </DefaultLayout>
  )
}

export const getStaticProps = async () => {
  const bio = allGlobals.find((g) => g.path == "global/bio")

  if (!bio) {
    throw new Error("No bio found, check global content")
  }

  const [topTracks, reviews, currentlyReading] = await Promise.all([
    getTopTracks({ limit: 10 }),
    getReviews({ limit: 10, trimTitle: true }),
    getCurrentlyReading({ limit: 2, trimTitle: true }),
  ])

  return {
    props: {
      bio: bio.body,
      topTracks,
      reviews,
      currentlyReading,
    },
    revalidate: 60 * 60 * 1, // Revalidate after 1 hour
  }
}

export default AboutPage
