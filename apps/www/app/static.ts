import {
  IconBrandGithub,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTelegram,
  IconBrandTwitter,
} from "@tabler/icons-react"

export const twitter = "https://twitter.com/wovalle"
export const instagram = "https://instagram.com/wovalle"
export const linkedin = "https://linkedin.com/in/wovalle"
export const telegram = "https://t.me/wovalle"
export const github = "https://github.com/wovalle"
export const resume = "/resume.pdf"
export const spotifyPlaylistUrl =
  "https://open.spotify.com/playlist/2DTIGceTBxntcToaVl0lxR?si=M5aF2T7OQjCyO2lS2wxMzw"
export const ama = "https://github.com/wovalle/willy.im/discussions/6"

export const tweetIntent = "https://twitter.com/intent/tweet?text="

export const socialMedia = [
  {
    name: "twitter",
    tooltip: "Willy's Twitter",
    link: twitter,
    icon: IconBrandTwitter,
  },
  {
    name: "github",
    tooltip: "Willy's Github",
    link: github,
    icon: IconBrandGithub,
  },
  {
    name: "instagram",
    tooltip: "Willy's Instagram",
    link: instagram,
    icon: IconBrandInstagram,
  },
  {
    name: "linkedin",
    tooltip: "Willy's LinkedIn",
    link: linkedin,
    icon: IconBrandLinkedin,
  },
  {
    name: "telegram",
    tooltip: "Willy's Telegram",
    link: telegram,
    icon: IconBrandTelegram,
  },
]

export const navLinks = [
  { name: "/home", url: "/", in: ["header", "footer"] },
  { name: "/posts", url: "/posts", in: ["header", "footer"] },
  { name: "/about", url: "/about", in: ["header", "footer"] },
  { name: "/privacy", url: "/privacy", in: ["footer"] },
]

export const siteConfig = {
  pathPrefix: "/",
  keywords: [
    "Willy Ovalle",
    "wovalle",
    "willy Ovalle",
    "Software Developer",
    "Software Engineer",
    "react",
    "Redux",
    "Typescript",
    "Jest",
    "Docker",
    "Frontend",
    "Engineering",
    "serverless",
    "React Router",
    "Remix",
    "Cloudflare",
    "Cloudflare Workers",
  ],
  title: "Willy Ovalle | Software Developer & Engineer",
  titleAlt: "Willy Ovalle | Software Developer & Engineer",
  description:
    "Willy Ovalle is a Dominican software developer and engineer. Explore projects, blog posts about React, TypeScript, Cloudflare Workers, and more.",
  url: "https://willy.im",
  siteLanguage: "en",
  logo: "public/logo.png",
  imageUrl: "https://willy.im/og/twitter.png",
  favicon: "public/favicon.png",
  shortName: "wovalle",
  author: "Willy Ovalle",
  twitter: "@wovalle",
  twitterDesc:
    "Willy Ovalle is a software engineer and bad jokes enthusiast currently based in Santo Domingo, Dominican Republic.",
}

export type PageMetaOptions = {
  title: string
  description: string
  path?: string
  image?: string
  type?: "website" | "article"
  publishedTime?: string
  modifiedTime?: string
}

export function createPageMeta({
  title,
  description,
  path = "/",
  image = siteConfig.imageUrl,
  type = "website",
  publishedTime,
  modifiedTime,
}: PageMetaOptions) {
  const url = `${siteConfig.url}${path === "/" ? "" : path}`
  const meta: Array<{ title?: string } | { name: string; content: string } | { property: string; content: string } | { tagName: "link"; rel: string; href: string }> = [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:url", content: url },
    { property: "og:type", content: type },
    { property: "og:site_name", content: siteConfig.title },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ]
  if (publishedTime && type === "article") {
    meta.push({ property: "article:published_time", content: publishedTime })
  }
  if (modifiedTime && type === "article") {
    meta.push({ property: "article:modified_time", content: modifiedTime })
  }
  return meta
}
