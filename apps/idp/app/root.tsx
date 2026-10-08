import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router"
import { getLuchy, LuchyScript } from "luchy/react-router"

import type { Route } from "./+types/root"
import "./app.css"

/** The browser script's config, with the request's identity already signed. */
export async function loader({ context }: Route.LoaderArgs) {
  return { luchy: await getLuchy(context) }
}

export const links: Route.LinksFunction = () => [
  {
    rel: "icon",
    href: "/favicon.svg",
    type: "image/svg+xml",
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root")
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:bg-background focus:text-foreground focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
        {import.meta.env.PROD && data && <LuchyScript {...data.luchy} />}
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
