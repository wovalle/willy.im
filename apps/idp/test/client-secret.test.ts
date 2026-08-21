import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import * as schema from "../app/db/schema"
import { createAuthService } from "../app/lib/auth.server"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from "../app/lib/client-secret.server"
import { createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * The client-secret hasher is a wire format shared with
 * @better-auth/oauth-provider: four clients are already stored with it, and the
 * plugin verifies them by hashing and comparing. So there are two pins here —
 * the *format* (a fixed vector, padding included) and the *contract* (a client
 * created through the plugin's own endpoint stores exactly what we would).
 */
describe("hashClientSecret", () => {
  it("is SHA-256 -> base64url without padding", async () => {
    // SHA-256("correct horse battery staple") is 32 bytes, so base64 would pad
    // with a single "=". The absence of it is the whole point of this vector.
    const expected = "xLvLH77JnWW_WdhcjLYu4tuWPw_hBvSD2a-nO9Tjmoo"
    expect(await hashClientSecret("correct horse battery staple")).toBe(expected)
    expect(expected).not.toContain("=")
    expect(expected).not.toMatch(/[+/]/)
  })

  it("matches a hash computed the long way round", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("s3cr3t"))
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    const expected = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

    expect(await hashClientSecret("s3cr3t")).toBe(expected)
  })

  it("mints credentials in the plugin's shape: 32 chars of [a-zA-Z]", () => {
    for (const value of [generateClientId(), generateClientSecret()]) {
      expect(value).toHaveLength(32)
      expect(value).toMatch(/^[a-zA-Z]{32}$/)
    }
    expect(generateClientSecret()).not.toBe(generateClientSecret())
  })
})

/**
 * Better Auth reads the session token from a signed cookie: `<value>.<sig>`,
 * HMAC-SHA256 over the value, base64, then percent-encoded. Reimplemented here
 * (it's four lines) rather than reaching into better-call, which apps/idp does
 * not depend on directly.
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
  return encodeURIComponent(`${value}.${base64}`)
}

describe("the plugin and our hasher agree", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  it("stores what hashClientSecret would when the plugin creates the client", async () => {
    const auth = createAuthService(h.ctx)
    const user = await createUser(h.ctx, { email: "super@willy.im" })

    // A live session, cookie-signed the way Better Auth expects — the plugin's
    // create-client endpoint sits behind sessionMiddleware.
    const token = `tok_${crypto.randomUUID()}`
    await h.ctx.db.insert(schema.session).values({
      id: `sess_${crypto.randomUUID()}`,
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const authContext = await auth.$context
    const cookieName = authContext.authCookies.sessionToken.name
    const headers = new Headers({
      cookie: `${cookieName}=${await signCookieValue(token, h.ctx.getAppEnv("BETTER_AUTH_SECRET"))}`,
    })

    const created = (await auth.api.createOAuthClient({
      headers,
      body: { client_name: "Pin", redirect_uris: ["https://pin.test/callback"] },
    })) as { client_id: string; client_secret: string }

    const [row] = await h.ctx.db
      .select({ clientSecret: schema.oauthClient.clientSecret })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, created.client_id))

    expect(created.client_secret).toMatch(/^[a-zA-Z]{32}$/)
    expect(row.clientSecret).toBe(await hashClientSecret(created.client_secret))
  })
})
