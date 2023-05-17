const { withAxiom } = require("next-axiom")
const { withContentlayer } = require("next-contentlayer")

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
  },
  aliases: {
    twitter: ["tw"],
    instagram: ["ig"],
    telegram: ["tg"],
    github: ["gh"],
    linkedin: ["li"],
  },
}
/**
 * @type {import('next').NextConfig}
 */
module.exports = withAxiom(
  withContentlayer({
    async redirects() {
      return Object.entries(links.redirects)
        .map(([key, link]) => {
          const sources = [key].concat(links.aliases[key])

          return sources.map((s) => ({
            source: `/${s}`,
            destination: link,
            permanent: true,
          }))
        })
        .flat()
    },
    webpack: (config, options) => {
      config.module.rules.push({
        test: /\.tsx?/,
        use: [options.defaultLoaders.babel],
      })

      return config
    },
    experimental: {
      newNextLinkBehavior: true,
    },
    images: {
      domains: ["i.scdn.co"], // Spotify
    },
  })
)
