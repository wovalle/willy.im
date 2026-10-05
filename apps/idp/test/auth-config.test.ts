import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as schema from "../app/db/schema"
import { createAuthService } from "../app/lib/auth.server"
import { createApplication, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Better Auth configuration invariants the IdP depends on but that live in
 * plugin/option defaults, so they are easy to regress silently.
 */
describe("Better Auth configuration", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  /**
   * Better Auth defaults rate limiting to `NODE_ENV === "production"`, but the
   * Worker sets APP_ENV, not NODE_ENV — so the limiter must be turned on
   * explicitly or it is off in the deployed IdP.
   */
  it("enables rate limiting regardless of NODE_ENV", async () => {
    const previous = process.env.NODE_ENV
    delete process.env.NODE_ENV
    try {
      const auth = createAuthService(h.ctx, "http://localhost:5173")
      expect((auth.options.rateLimit as { enabled?: boolean }).enabled).toBe(true)
      // Plugin init (oauth_resource seeding) starts with the service; let it
      // finish before afterEach closes the database under it.
      await auth.$context
    } finally {
      if (previous !== undefined) process.env.NODE_ENV = previous
    }
  })

  /**
   * Workspaces are created and populated through our own kit methods, which
   * enforce `workspace:create` / `member:manage`. Better Auth's organization
   * endpoints must not be a second, weaker door: a signed-in user must not be
   * able to create a workspace (and become its owner) in an arbitrary app.
   */
  describe("organization endpoints are closed to users", () => {
    const signCookieValue = async (value: string, secret: string) => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      )
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
      return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)
    }

    /** A live, cookie-signed session for `userId`, the way Better Auth reads it. */
    const sessionHeaders = async (
      auth: ReturnType<typeof createAuthService>,
      userId: string,
    ) => {
      const token = `tok_${crypto.randomUUID()}`
      await h.ctx.db.insert(schema.session).values({
        id: `sess_${crypto.randomUUID()}`,
        token,
        userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const name = (await auth.$context).authCookies.sessionToken.name
      return new Headers({
        cookie: `${name}=${await signCookieValue(token, h.ctx.getAppEnv("BETTER_AUTH_SECRET"))}`,
        "content-type": "application/json",
      })
    }

    it("refuses /organization/create for a signed-in user and writes nothing", async () => {
      const auth = createAuthService(h.ctx, "http://localhost:5173")
      const user = await createUser(h.ctx, { email: "nobody@internet.test" })
      await createApplication(h.ctx, { app: "bender" })
      const headers = await sessionHeaders(auth, user.id)

      const failure = await auth.api
        .createOrganization({
          headers,
          body: { name: "pwn", slug: `pwn-${Date.now()}`, applicationId: "bender" } as never,
        })
        .then(
          () => null,
          (e: { statusCode?: number }) => e,
        )

      expect(failure?.statusCode).toBeGreaterThanOrEqual(400)
      const orgs = await h.ctx.db.select().from(schema.organization)
      expect(orgs).toHaveLength(0)
    })
  })
})
