import clsx from "clsx"
import React, { Suspense } from "react"
import { FaSpotify, FaSpinner } from "react-icons/fa"
import { useNowPlaying } from "../hooks/useNowPlaying"

const NowPlaying: React.FC = () => {
  const nowPlaying = useNowPlaying()

  if (!nowPlaying.isPlaying) {
    return <>Nothing 🙃</>
  }

  return (
    <a href={nowPlaying?.url || ""}>
      {nowPlaying?.songName} - {nowPlaying?.artistName}
    </a>
  )
}

const Footer = () => {
  const links = [["About"], ["Twitter"], ["Github"], ["LinkedIn"], ["Contact"]].map((e) => (
    <li className="pt-2" key={e[0]}>
      {e[0]}
    </li>
  ))

  const { isPlaying } = useNowPlaying()
  const spotifyIconClass = clsx("mr-2", { "animate-spin": isPlaying })

  return (
    <>
      <hr className="w-full border-gray-200 border-1 dark:border-gray-800" />
      <footer className="flex flex-row px-8 py-4">
        <ul className="w-full">
          <li className="flex flex-col py-1 md:flex-row md:space-x-2">
            <div className="flex items-center">
              <FaSpotify
                className={spotifyIconClass}
                size="1.2rem"
                color={isPlaying ? "#1DB954" : ""}
              />{" "}
              {"Now Playing:   "}
            </div>
            <Suspense fallback={<FaSpinner />}>
              <NowPlaying />
            </Suspense>
          </li>
          {links}
        </ul>
      </footer>
    </>
  )
}

export default Footer
