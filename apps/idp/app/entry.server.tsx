import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router"
import { isRouteErrorResponse, ServerRouter } from "react-router"
import { isbot } from "isbot"
import { renderToReadableStream } from "react-dom/server"

import { reportError } from "./lib/error-reporting.server"

/**
 * Loader, action and render errors React Router caught and turned into an
 * error response. Exporting this replaces React Router's default, a bare
 * console.error, so that line is kept. A 4xx (no route matches, method not
 * allowed) is an answer, not a failure: logged, never reported.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return
  console.error(error)
  if (isRouteErrorResponse(error) && error.status < 500) return
  reportError(error, "react-router")
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  let shellRendered = false
  const userAgent = request.headers.get("user-agent")

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500
        // Before the shell, the error rejects renderToReadableStream and React
        // Router hands it to handleError. After it, this is the only observer.
        if (shellRendered) {
          console.error(error)
          reportError(error, "render")
        }
      },
    },
  )
  shellRendered = true

  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8")

  // Security headers. An IdP must never be embeddable (clickjacking on the
  // login/consent screens), hence DENY + frame-ancestors 'none'.
  responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
  responseHeaders.set("X-Frame-Options", "DENY")
  responseHeaders.set("X-Content-Type-Options", "nosniff")
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin")
  responseHeaders.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  )
  responseHeaders.set("Content-Security-Policy", "frame-ancestors 'none';")

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  })
}
