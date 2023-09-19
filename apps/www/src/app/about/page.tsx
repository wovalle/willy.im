import { required } from "@willyim/common"
import { Metadata } from "next"
import { getMDXComponent } from "next-contentlayer/hooks"
import { allGlobals } from "../../../.contentlayer/generated"
import { getCurrentlyReading, getReviews } from "../../lib/goodreads"
import { getMainAccountTokens } from "../../lib/queries/auth"
import { getTopTracks } from "../../lib/spotify"
import { getLikedVideos, YoutubeVideo } from "../../lib/youtube"
import { PageSection } from "../components/PageSection"
import { BooksSection } from "./components/BookSection"
import { TopTracksSection } from "./components/TopTracksSection"
import { VideosSection } from "./components/VideosSection"

export const metadata: Metadata = {
  title: "About",
  description: "About me",
}

const getAboutData = () =>
  Promise.all([
    getTopTracks({ limit: 50 }),
    getReviews({ limit: 50, trimTitle: true }),
    getCurrentlyReading({ limit: 2, trimTitle: true }),
    getMainAccountTokens().then((tokens) =>
      getLikedVideos({
        userToken: required(tokens.access_token, "account.access_token is required"),
        refreshToken: required(tokens.refresh_token, "account.refresh_token is required"),
      }).catch(() => [] as YoutubeVideo[])
    ),
  ])

export default async function AboutPage() {
  const bio = required(
    allGlobals.find((g) => g.path == "global/bio"),
    "Invalid bio, check global content"
  )

  const [topTracks, reviews, currentlyReading, videos] = await getAboutData()
  const Bio = getMDXComponent(bio.body.code)

  return (
    <main className="flex flex-grow flex-col px-6 py-10">
      <PageSection
        id="bio"
        title="who i am"
        bodyClassName="leading-relaxed text-lg gap-4 flex flex-col markdown"
      >
        <Bio />
      </PageSection>

      <TopTracksSection topTracks={topTracks} />

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
  )
}
