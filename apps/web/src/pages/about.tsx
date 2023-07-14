import { allGlobals } from "contentlayer/generated"
import type { InferGetStaticPropsType, NextPage } from "next"
import { useMDXComponent } from "next-contentlayer/hooks"
import { BooksSection } from "../components/About/BookSection"
import { TopTracksSection } from "../components/About/TopTracksSection"
import { DefaultLayout } from "../components/Layout"
import { PageSection } from "../components/PageSection"
import { getCurrentlyReading, getReviews } from "../lib/goodreads"
import { getTopTracks } from "../lib/spotify"

const AboutPage: NextPage<InferGetStaticPropsType<typeof getStaticProps>> = ({
  bio,
  topTracks,
  reviews,
  currentlyReading,
}) => {
  const Bio = useMDXComponent(bio.code)

  return (
    <DefaultLayout title="About">
      <main className="flex flex-grow flex-col px-6 py-10">
        <PageSection
          id="bio"
          title="who i am"
          bodyClassName="leading-relaxed text-lg gap-4 flex flex-col markdown"
        >
          <Bio />
        </PageSection>

        <TopTracksSection topTracks={topTracks} />

        <BooksSection reviews={reviews} currentlyReading={currentlyReading} />

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

// TODO: runtime validations
export const getStaticProps = async () => {
  const bio = allGlobals.find((g) => g.path == "global/bio")

  if (!bio) {
    throw new Error("No bio found, check global content")
  }

  const [topTracks, reviews, currentlyReading] = await Promise.all([
    getTopTracks({ limit: 50 }),
    getReviews({ limit: 50, trimTitle: true }),
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
