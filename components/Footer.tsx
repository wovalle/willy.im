import { useState } from "react"
import { FaSpotify } from "react-icons/fa"

const Footer = () => {
  const [isPlaying, setIsPlaying] = useState(false)
  const links = [["About"], ["Twitter"], ["Github"], ["LinkedIn"], ["Contact"]].map((e) => (
    <li className="pt-2">{e[0]}</li>
  ))

  const nowPlaying = <a>{isPlaying ? "Super Cool Song - Super Cool Band" : "Nothing 🙃"}</a>

  return (
    <>
      <hr className="w-full border-1 border-gray-200 dark:border-gray-800" />
      <footer className="flex flex-row px-8 py-4">
        <ul className="w-full">
          <li className="flex py-1 flex-col md:flex-row md:space-x-2">
            <div className="flex items-center">
              <FaSpotify
                onClick={() => setIsPlaying(!isPlaying)}
                className={`mr-2 ${isPlaying ? "animate-spin" : ""}`}
                size="1.2rem"
              />{" "}
              {"Now Playing:   "}
            </div>
            <div className="">{nowPlaying}</div>
          </li>
          {links}
        </ul>
      </footer>
    </>
  )
}

export default Footer
