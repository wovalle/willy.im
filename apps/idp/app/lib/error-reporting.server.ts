import * as Sentry from "@sentry/cloudflare"

import type { AppEnv } from "./env"

/**
 * Error reporting: GlitchTip at bugs.romo.fyi (Sentry protocol), org `kasso`,
 * project `idp`. Errors only — no tracing, no logs.
 *
 * `withSentry` (workers/app.ts) opens a scope per request, so anything reported
 * while a request is in flight carries its method and URL. Without a DSN the
 * SDK still wraps the handler but sends nothing — local dev and tests.
 *
 * This is an IdP: requests carry session cookies, OTP codes, client secrets and
 * authorization codes. The SDK's defaults collect cookies, headers, bodies and
 * query strings, so everything is narrowed explicitly here.
 */
export function sentryOptions(env: AppEnv): Sentry.CloudflareOptions {
  return {
    dsn: env.GLITCHTIP_DSN || undefined,
    environment: env.APP_ENV,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: {
        request: { allow: ["user-agent", "referer", "origin", "content-type", "accept"] },
        response: false,
      },
      // `code` covers OTPs (/login/verify), authorization codes (OAuth
      // callbacks), PKCE challenges and consent codes. Names with "token",
      // "secret", "session", "auth" … are always filtered by the SDK.
      urlQueryParams: { deny: ["code", "email", "state", "nonce"] },
      databaseQueryData: false,
    },
  }
}

/** Where a reported error was caught, as a `source` tag to filter on in GlitchTip. */
export type ErrorSource = "better-auth" | "react-router" | "render"

/**
 * Report an error that was caught — and so never reaches `withSentry` — but
 * still failed the request. Never throws: reporting must not be what breaks
 * the response.
 */
export function reportError(error: unknown, source: ErrorSource): void {
  try {
    Sentry.captureException(error, { tags: { source } })
  } catch {
    // The caller logs the error too; losing the report is the lesser evil.
  }
}
