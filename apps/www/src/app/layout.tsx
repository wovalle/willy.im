import type { Metadata } from "next"
import { Lato } from "next/font/google"
import { ReactNode } from "react"
import { siteConfig } from "../lib/static"
import { cn } from "../utils/cn"
import Footer from "./components/Footer"
import { Header } from "./components/header/Header"
import "./globals.css"
import { Providers } from "./providers"

const font = Lato({ weight: ["400", "700"], display: "swap", subsets: ["latin"] })

export const metadata: Metadata = {
  title: {
    default: "Willy Ovalle",
    template: "%s | Willy Ovalle",
  },
  description: "Willy Ovalle's home on the internet",
  viewport: "width=device-width, initial-scale=1",
  metadataBase: new URL("https://willy.im"),
  openGraph: {
    title: "Willy Ovalle",
    description: "Willy Ovalle's home on the internet",
    url: "https://willy.im",
    siteName: "Willy Ovalle",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/android-chrome-512x512.png",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  twitter: {
    card: "summary_large_image",
    creator: "@wovalle",
    creatorId: "148689340",
  },
  keywords: siteConfig.keywords.join(","),
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
  },

  manifest: "/site.webmanifest",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(font.className, "bg-white", "dark:bg-neuda-800")}>
        <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col overflow-hidden text-gray-700 dark:text-gray-200">
          <Providers>
            <Header />
            {children}
          </Providers>
        </div>
        <Footer />
      </body>
    </html>
  )
}
