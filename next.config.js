const links = {
  redirects: {
    twitter: "https://twitter.com/wovalle",
    instagram: "https://instagram.com/wovalle",
    linkedin: "https://www.linkedin.com/in/willyovalle/",
    telegram: "https://t.me/wovalle",
    github: "https://github.com/wovalle",
  },
  aliases: {
    twitter: ["tw"],
    instagram: ["ig"],
    telegram: ["tg"],
    github: ["gh"],
    linkedin: ["li"],
  },
}

module.exports = {
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
}
