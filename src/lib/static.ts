import { FaGithub, FaTwitter, FaInstagram, FaLinkedin, FaTelegram } from "react-icons/fa"

export const twitter = "https://twitter.com/wovalle"
export const instagram = "https://instagram.com/wovalle"
export const linkedin = "https://linkedin.com/in/willyovalle"
export const telegram = "https://t.me/wovalle"
export const github = "https://github.com/wovalle"
export const resume = "/resume.pdf"
export const playlist =
  "https://open.spotify.com/playlist/2DTIGceTBxntcToaVl0lxR?si=M5aF2T7OQjCyO2lS2wxMzw"
export const ama = "https://github.com/wovalle/willy.im/discussions/6"

export const socialMedia = [
  {
    name: "twitter",
    tooltip: "Willy's Twitter",
    link: twitter,
    icon: FaTwitter,
  },
  {
    name: "github",
    tooltip: "Willy's Github",
    link: github,
    icon: FaGithub,
  },
  {
    name: "instagram",
    tooltip: "Willy's Instagram",
    link: instagram,
    icon: FaInstagram,
  },
  {
    name: "linkedin",
    tooltip: "Willy's LinkedIn",
    link: linkedin,
    icon: FaLinkedin,
  },
  {
    name: "telegram",
    tooltip: "Willy's Telegram",
    link: instagram,
    icon: FaTelegram,
  },
]

export const markdownBio = `
Hi there 👋🏼! I'm Willy Ovalle, a software developer based in Berlin, 🇩🇪. I grew up in Santo Domingo, 🇩🇴, graduated in [Telecommunications Engineering](https://www.pucmm.edu.do/ingenierias/telematica) and have a Master's in [Science of Networking and Systems Administration](https://www.rit.edu/study/networking-and-systems-administration-ms). I currently work automating social advertising at [smartly.io](smartly.io) (prev [klarna](https://klarna.com), [instacarro](https://instacarro.com)).

I have been working professionally [since 2012](${linkedin}) (*damn it has been that long?* 😥), working in small and big companies in Santo Domingo, Austin, Stockholm and now Berlin. Originally I started my career in the .NET stack (along many other Microsoft technologies), these days I do most of my work in [typescript](typescriptlang.org) (and js in general). Some tools/technologies I'm interested in: typescript, node, docker, k8s, jamstack, serverless.

I spend my free time [playing music](#top-tracks), [reading](#book-reviews) (mostly listening tbh) books, doing [open source work](https://github.com/wovalle), enjoying time with friends and family and watching way too much youtube. Catch me up on [twitter](${twitter})… or don’t, it's your call; I’m only a biography after all.
`
