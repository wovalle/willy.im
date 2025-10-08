import { IconArrowLeft } from "@tabler/icons-react"
import { Link } from "react-router"
import type { Route } from "./+types/links.onlyfans"

export const meta: Route.MetaFunction = () => {
  return [
    { title: "OnlyFans - Willy Ovalle" },
    {
      name: "description",
      content: "Exclusive content by Willy Ovalle",
    },
  ]
}

export default function OnlyFans() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-800">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-12">
        {/* Back Button */}
        <div className="mb-8 w-full">
          <Link
            to="/links"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
          >
            <IconArrowLeft size="1.2em" />
            Back to Links
          </Link>
        </div>

        {/* Video Section */}
        <div className="w-full max-w-4xl">
          <div className="mb-6 text-center">
            <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
              OnlyFans Exclusive
            </h1>
            <p className="text-gray-600 dark:text-gray-400">Special content for my supporters</p>
          </div>

          <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-black">
            <video
              src="https://assets.willy.im/onlyfans.mp4"
              controls
              autoPlay
              loop
              playsInline
              className="w-full h-auto"
            >
              Your browser does not support the video tag.
            </video>
          </div>

          {/* Additional Info */}
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl px-6 py-4 shadow-lg">
              <span className="rounded-full bg-gradient-to-r from-pink-500 to-purple-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
                10% OFF
              </span>
              <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                $9.99/month
              </span>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Limited time offer - Join now!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
