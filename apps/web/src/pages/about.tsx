import { required } from "@willyim/common"
import { allGlobals } from "contentlayer/generated"
import type { InferGetStaticPropsType, NextPage } from "next"
import { useMDXComponent } from "next-contentlayer/hooks"
import { authDb } from "../../db/kysely"
import { BooksSection } from "../components/About/BookSection"
import { TopTracksSection } from "../components/About/TopTracksSection"
import { VideosSection } from "../components/About/VideosSection"
import { ClientOnly } from "../components/ClientOnly"
import { DefaultLayout } from "../components/Layout"
import { PageSection } from "../components/PageSection"
import { getCurrentlyReading, getReviews } from "../lib/goodreads"
import { getTopTracks } from "../lib/spotify"
import { getLikedVideos } from "../lib/youtube"

const AboutPage: NextPage<InferGetStaticPropsType<typeof getStaticProps>> = ({
  bio,
  topTracks,
  reviews,
  currentlyReading,
  videos,
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

        <ClientOnly>
          <TopTracksSection topTracks={topTracks} />
        </ClientOnly>

        <VideosSection videos={videos} />

        <BooksSection reviews={reviews} currentlyReading={currentlyReading} />

        {/* 
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
    getTopTracks({ limit: 50 }),
    getReviews({ limit: 50, trimTitle: true }),
    getCurrentlyReading({ limit: 2, trimTitle: true }),
  ])

  // Eventually this will become a getServerSideProps call, now I cannot use it
  // because is not allowed in getStaticProps
  const account = await authDb
    .selectFrom("auth_account")
    .select(["access_token", "refresh_token"])
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required"),
    )
    .executeTakeFirstOrThrow()

  const videos = await getLikedVideos({
    userToken: required(account.access_token, "account.access_token is required"),
    refreshToken: required(account.refresh_token, "account.refresh_token is required"),
  }).catch((e) => {
    console.error("Error fetching youtube videos", e)
    return []
  })

  return {
    props: {
      bio: bio.body,
      topTracks,
      reviews,
      currentlyReading,
      videos,
    },
    revalidate: 60 * 60 * 1, // Revalidate after 1 hour
  }
}

export default AboutPage
