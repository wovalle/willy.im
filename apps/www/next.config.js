// const { withAxiom } = require("next-axiom")
const { withContentlayer } = require("next-contentlayer")

// TODO: I need to duplicate this link info because next.config is a js file
// and cannot import lib/static. Maybe someday I'll be able to fix this.
const twitter = "https://twitter.com/wovalle"
const instagram = "https://instagram.com/wovalle"
const linkedin = "https://linkedin.com/in/willyovalle"
const telegram = "https://t.me/wovalle"
const github = "https://github.com/wovalle"
const resume = "/resume.pdf"
const playlist =
  "https://open.spotify.com/playlist/2DTIGceTBxntcToaVl0lxR?si=M5aF2T7OQjCyO2lS2wxMzw"

const links = {
  redirects: {
    twitter,
    instagram,
    linkedin,
    telegram,
    github,
    resume,
    playlist,
    "posts/how-to-check-if-youre-being-rickrolled-in-telegram":
      "https://www.youtube.com/watch?v=UNuogmk7oEA",
    r: {
      source: "/r/:path*",
      destination: "/redir/:path*",
      permanent: false,
    },
  },
  aliases: {
    twitter: ["tw"],
    instagram: ["ig"],
    telegram: ["tg"],
    github: ["gh"],
    linkedin: ["li"],
  },
}

const getRedirectsNext = () =>
  Object.entries(links.redirects)
    .map(([key, linkOrRedirectObject]) => {
      const sources = [key].concat(links.aliases[key])

      return sources.map((s) =>
        typeof linkOrRedirectObject === "string"
          ? {
              source: `/${s}`,
              destination: linkOrRedirectObject,
              permanent: false,
            }
          : linkOrRedirectObject
      )
    })
    .flat()

/**
 * @type {import('next').NextConfig}
 */
module.exports =
  // withAxiom(
  withContentlayer({
    redirects() {
      return getRedirectsNext()
    },
    images: {
      domains: ["i.scdn.co"], // Spotify
    },

    webpack: (config, options) => {
      if (typeof nextRuntime === "undefined") {
        config.resolve.fallback = {
          ...config.resolve.fallback,
          fs: false,
        }
      }

      // WORKAROUND: contentlayer adds a rule that breaks @neondatabase/severless, let's remove it
      const rules = config.module?.rules
      const weirdRule = rules.findIndex((rule) => rule.test?.toString() === "/\\.m?js$/")

      if (weirdRule !== -1) {
        rules.splice(weirdRule, 1)
      }

      return config
    },
    transpilePackages: ["@willyim/common"],
  })
// )
