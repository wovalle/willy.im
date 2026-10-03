import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"

import { createAuthService } from "../app/lib/auth.server"
import { sentryOptions } from "../app/lib/error-reporting.server"
import { getAppEnv } from "../app/lib/env"
import { createTestHarness, type TestHarness } from "./helpers/harness"

const captureException = vi.hoisted(() => vi.fn())
vi.mock("@sentry/cloudflare", () => ({ captureException }))

/**
 * Better Auth catches everything an endpoint throws and answers with a status,
 * so its failures never reach the worker's own error handling. They are only
 * reported because of the `onAPIError` hook in auth.server.ts.
 */
describe("Better Auth failures", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
    captureException.mockClear()
  })
  afterEach(() => h.close())

  it("reports an exception inside an endpoint, which still answers 500", async () => {
    const auth = createAuthService(h.ctx)
    // The JWKS endpoint reads its table first thing; without it the adapter
    // throws a plain SqliteError, the kind of bug that took /oauth2/authorize
    // down for hours unnoticed.
    await h.ctx.db.run(sql`DROP TABLE jwks`)
    // better-call prints its own "# SERVER_ERROR:" line on the way to the 500.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await auth.handler(new Request("http://localhost:5173/auth/jwks"))
    consoleError.mockRestore()

    expect(res.status).toBe(500)
    expect(captureException).toHaveBeenCalledTimes(1)
    const [error, hint] = captureException.mock.calls[0]!
    expect(String((error as Error).cause)).toMatch(/no such table: jwks/)
    expect(hint).toEqual({ tags: { source: "better-auth" } })
    expect(h.logs).toContainEqual(
      expect.objectContaining({ level: "error", message: "auth.api.error" }),
    )
  })

  it("does not report a 4xx: a rejected request is an answer, not a failure", async () => {
    const auth = createAuthService(h.ctx)

    const res = await auth.handler(
      new Request("http://localhost:5173/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:5173" },
        body: JSON.stringify({ type: "sign-in" }),
      }),
    )

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(captureException).not.toHaveBeenCalled()
  })
})

describe("sentryOptions", () => {
  let h: TestHarness
  afterEach(() => h.close())

  it("leaves the SDK without a DSN when GLITCHTIP_DSN is unset or empty", () => {
    h = createTestHarness({ env: { GLITCHTIP_DSN: "" } })
    expect(sentryOptions(getAppEnv()).dsn).toBeUndefined()
  })

  it("never collects cookies, bodies or user info", () => {
    h = createTestHarness({ env: { GLITCHTIP_DSN: "https://key@bugs.example/4" } })
    const options = sentryOptions(getAppEnv())
    expect(options.dsn).toBe("https://key@bugs.example/4")
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
    })
  })
})
