import {
  IconBrandGithub,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTelegram,
  IconBrandTwitter,
  IconExternalLink,
  IconHeart,
} from "@tabler/icons-react"
import { siteConfig, socialMedia } from "~/static"
import type { Route } from "./+types/links"

export const meta: Route.MetaFunction = () => {
  return [
    { title: `${siteConfig.title} - Links` },
    {
      name: "description",
      content: "Connect with Willy Ovalle - All my links in one place",
    },
  ]
}

export const links: Route.LinksFunction = () => [
  {
    rel: "prefetch",
    href: "https://assets.willy.im/onlyfans.mp4",
    as: "video",
  },
]

interface LinkButtonProps {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode
  isExternal?: boolean
}

const LinkButton = ({ href, children, icon, badge, isExternal = true }: LinkButtonProps) => {
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="group relative flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/80 px-6 py-4 text-gray-900 shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-gray-200/50 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100 dark:hover:shadow-gray-800/50"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
            {icon}
          </div>
        )}
        <span className="font-semibold">{children}</span>
      </div>
      <div className="flex items-center gap-2">
        {badge}
        <IconExternalLink
          size="1.2em"
          className="text-gray-400 transition-transform group-hover:translate-x-1 group-hover:translate-y-[-1px]"
        />
      </div>
    </a>
  )
}

const DiscountBadge = () => (
  <span className="rounded-full bg-gradient-to-r from-pink-500 to-purple-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
    10% OFF
  </span>
)

const PriceBadge = ({ price }: { price: string }) => (
  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
    {price}
  </span>
)

export default function Links() {
  const linkItems = [
    {
      href: "/links/onlyfans",
      label: "OnlyFans",
      icon: <IconHeart size="1.2em" className="text-pink-500" />,
      badge: <PriceBadge price="$9.99" />,
      isExternal: false,
    },
    {
      href: "https://github.com/wovalle",
      label: "GitHub",
      icon: <IconBrandGithub size="1.2em" className="text-gray-700 dark:text-gray-300" />,
    },
    {
      href: "https://twitter.com/wovalle",
      label: "Twitter",
      icon: <IconBrandTwitter size="1.2em" className="text-blue-400" />,
    },
    {
      href: "https://instagram.com/wovalle",
      label: "Instagram",
      icon: <IconBrandInstagram size="1.2em" className="text-pink-500" />,
    },
    {
      href: "https://linkedin.com/in/wovalle",
      label: "LinkedIn",
      icon: <IconBrandLinkedin size="1.2em" className="text-blue-600" />,
    },
    {
      href: "https://t.me/wovalle",
      label: "Telegram",
      icon: <IconBrandTelegram size="1.2em" className="text-blue-500" />,
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-800">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        {/* Profile Section */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4">
            <img
              alt="Willy Ovalle's profile picture"
              src="/profile.png"
              width={120}
              height={120}
              className="rounded-full object-cover shadow-2xl ring-4 ring-white/50 dark:ring-gray-700/50"
            />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Willy Ovalle</h1>
          <p className="text-center text-gray-600 dark:text-gray-400">
            Dominican Software Developer who loves music, videogames and spends too much time
            watching youtube videos
          </p>
        </div>

        {/* Links Section */}
        <div className="mb-8 w-full space-y-4">
          {linkItems.map((link, index) => (
            <div key={link.href} className="flex flex-col items-center">
              {index === 0 && (
                <div className="mb-2 flex items-center gap-2">
                  <DiscountBadge />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Limited time offer!
                  </span>
                </div>
              )}
              <LinkButton
                href={link.href}
                icon={link.icon}
                badge={link.badge}
                isExternal={link.isExternal}
              >
                {link.label}
              </LinkButton>
            </div>
          ))}
        </div>

        {/* Social Icons */}
        <div className="flex items-center gap-4">
          {socialMedia.map(({ name, link, icon: Icon }) => (
            <a
              key={name}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/60 text-gray-600 shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:bg-white/80 hover:text-gray-900 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:bg-gray-700/80 dark:hover:text-gray-100"
            >
              <Icon size="1.2em" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
