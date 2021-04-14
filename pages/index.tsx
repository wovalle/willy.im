import Layout from "../components/Layout"
import Link from "next/link"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import {
  faGithub,
  faTwitter,
  faInstagram,
  faTelegram,
  faLinkedin,
} from "@fortawesome/free-brands-svg-icons"

const socialMedia = [
  {
    name: "twitter",
    tooltip: "Willy's Twitter",
    link: "//twitter.com/wovalle",
    icon: <FontAwesomeIcon icon={faTwitter} />,
  },
  {
    name: "github",
    tooltip: "Willy's Github",
    link: "//github.com/wovalle",
    icon: <FontAwesomeIcon icon={faGithub} />,
  },
  {
    name: "instagram",
    tooltip: "Willy's Instagram",
    link: "//instagram.com/wovalle",
    icon: <FontAwesomeIcon icon={faInstagram} />,
  },
  {
    name: "linkedin",
    tooltip: "Willy's LinkedIn",
    link: "//linkedin.com/in/willyovalle",
    icon: <FontAwesomeIcon icon={faLinkedin} />,
  },
  {
    name: "telegram",
    tooltip: "Willy's Telegram",
    link: "//t.me/wovalle",
    icon: <FontAwesomeIcon icon={faTelegram} />,
  },
].map((m) => (
  <li key={m.name}>
    <a data-tooltip={m.tooltip} href={m.link}>
      {m.icon}
    </a>
  </li>
))

const playlistLink =
  "https://open.spotify.com/playlist/2DTIGceTBxntcToaVl0lxR?si=M5aF2T7OQjCyO2lS2wxMzw"

const IndexPage = () => (
  <Layout title="Home | Willy Ovalle's site">
    <section className="hero">
      <div className="hero-body">
        <div className="container">
          <p className="subtitle">Hi there 👋🏼</p>
          <h1 className="title">
            I'm Willy<span style={{ color: "var(--accent-50)" }}>!</span>
          </h1>
          <p className="subtitle">
            Software Developer from 🇩🇴 living in 🇸🇪 who loves
            <Link href={playlistLink}>
              <a className="link"> music </a>
            </Link>
            and occassionally writes.
          </p>
          <ul className="icons">{socialMedia}</ul>
        </div>
      </div>
    </section>
  </Layout>
)

export default IndexPage
