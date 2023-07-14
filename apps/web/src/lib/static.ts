import {
  IconBrandGithub,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTelegram,
  IconBrandTwitter,
} from "@tabler/icons-react"

export const twitter = "https://twitter.com/wovalle"
export const instagram = "https://instagram.com/wovalle"
export const linkedin = "https://linkedin.com/in/willyovalle"
export const telegram = "https://t.me/wovalle"
export const github = "https://github.com/wovalle"
export const resume = "/resume.pdf"
export const playlist =
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

export const footerLinks = [
  { name: "/home", url: "/" },
  { name: "/about", url: "/about" },
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
    "Blog",
    "serverless",
  ],
  title: "Willy Ovalle's Blog",
  titleAlt: "Willy Ovalle | Blog",
  description: "Willy Ovalle's home on the internet",
  url: "https://willy.im",
  siteLanguage: "en",
  logo: "public/logo.png",
  imageUrl: "https://willy.im/public/og/og-twitter.png",
  favicon: "public/favicon.png",
  shortName: "WillyOvalle",
  author: "Willy Ovalle",
  twitter: "@wovalle",
  twitterDesc:
    "Willy Ovalle is a software engineer and bad jokes enthusiast currently based in Berlin.",
}
