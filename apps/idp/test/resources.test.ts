import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AuthService } from "../app/lib/auth.server"
import { APP_CLAIM, PERMISSIONS_CLAIM } from "../app/lib/claims.server"
import type { ResourceTypeDecl } from "../app/lib/metadata"
import { ResourceListError, createResourceLister } from "../app/lib/resources.server"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Asking an app which instances of a type it holds. The IdP never stores the
 * app's list, so this call is the only place the two sides meet — and the only
 * thing standing between them is a JWT the IdP signs with its own OIDC key.
 * The tests below pin both halves: what goes out on the wire, and what a
 * misbehaving app can and cannot do to us on the way back.
 */

const thread: ResourceTypeDecl = {
  type: "kirby:thread",
  label: "WhatsApp conversation",
  list: "https://bender.test/idp/resources/kirby-thread",
}

const ISSUER = "https://idp.willy.im/auth"

/**
 * Stands in for Better Auth's JWT plugin. The "token" is the payload itself,
 * so a test can read exactly what the app would have verified.
 */
const authStub = {
  api: {
    signJWT: async ({ body }: { body: { payload: Record<string, unknown> } }) => ({
      token: "t." + JSON.stringify(body.payload),
    }),
  },
} as unknown as AuthService

const payloadOf = (token: string) => JSON.parse(token.slice("t.".length)) as Record<string, unknown>

describe("createResourceLister", () => {
  let h: TestHarness
  let calls: { url: string; init: RequestInit }[]

  beforeEach(() => {
    h = createTestHarness()
    calls = []
  })
  afterEach(() => h.close())

  /** A fetch that records the request and answers whatever the test hands it. */
  const fetchStub = (answer: Response | Error) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (answer instanceof Error) throw answer
      return answer
    }) as unknown as typeof fetch

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

  const lister = (answer: Response | Error) =>
    createResourceLister({
      auth: authStub,
      issuer: ISSUER,
      logger: h.ctx.logger,
      fetch: fetchStub(answer),
    })

  it("GETs the declared list URL with the signed token as a bearer", async () => {
    await lister(json({ resources: [] }))({ app: "bender", type: thread })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(thread.list)
    expect(calls[0].init.method).toBe("GET")
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.accept).toBe("application/json")
    expect(headers.authorization).toMatch(/^Bearer t\./)
  })

  it("signs a token the app can verify exactly like any other access token", async () => {
    await lister(json({ resources: [] }))({ app: "bender", type: thread })
    const headers = calls[0].init.headers as Record<string, string>
    const payload = payloadOf(headers.authorization.slice("Bearer ".length))

    // `aud` is the list URL itself, so a token minted for one app's listing
    // cannot be replayed against another endpoint.
    expect(payload.aud).toBe(thread.list)
    expect(payload.iss).toBe(ISSUER)
    expect(payload.sub).toBe("idp")
    // A minute of life: long enough for one call, short enough that a captured
    // token is worthless.
    expect((payload.exp as number) - (payload.iat as number)).toBe(60)
    expect(payload[APP_CLAIM]).toBe("bender")
    expect(payload[PERMISSIONS_CLAIM]).toEqual(["idp:resources:list"])
  })

  it("returns the instances the app listed, defaulting a missing description to null", async () => {
    const instances = await lister(
      json({
        resources: [
          { id: "t_1", label: "Familia", description: "12 participantes" },
          { id: "t_2", label: "Trabajo" },
        ],
      }),
    )({ app: "bender", type: thread })

    // `description` is optional on the wire but never undefined to a consumer:
    // the picker renders a second line or it doesn't.
    expect(instances).toEqual([
      { id: "t_1", label: "Familia", description: "12 participantes" },
      { id: "t_2", label: "Trabajo", description: null },
    ])
  })

  it("reports `rejected` when the app answers non-2xx", async () => {
    await expect(
      lister(json({ error: "nope" }, 403))({ app: "bender", type: thread }),
    ).rejects.toMatchObject({ name: "ResourceListError", type: "kirby:thread", reason: "rejected" })
  })

  it("reports `unreachable` when the call never lands", async () => {
    const err = await lister(new Error("connect ECONNREFUSED"))({
      app: "bender",
      type: thread,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ResourceListError)
    expect(err).toMatchObject({ reason: "unreachable", type: "kirby:thread" })
  })

  it("reports `invalid_body` for a 200 that isn't the shape we asked for", async () => {
    // Not JSON at all — a login page from a misconfigured proxy, say.
    await expect(
      lister(new Response("<html>hi</html>", { status: 200 }))({ app: "bender", type: thread }),
    ).rejects.toMatchObject({ reason: "invalid_body" })

    // JSON, but without the `resources` array the contract names.
    await expect(
      lister(json({ threads: [] }))({ app: "bender", type: thread }),
    ).rejects.toMatchObject({ reason: "invalid_body" })
  })

  it("drops the rows it cannot read and says so, instead of failing the whole list", async () => {
    // One bad row in a hundred must not hide the ninety-nine good ones — but a
    // silent drop would look like the app simply doesn't have that thread, so
    // the count goes to the log an agent will actually read.
    const instances = await lister(
      json({
        resources: [
          { id: "t_1", label: "Familia" },
          { id: "t:2", label: "Colon in the id" },
          { id: "t_3", label: "" },
          "not even an object",
        ],
      }),
    )({ app: "bender", type: thread })

    expect(instances).toEqual([{ id: "t_1", label: "Familia", description: null }])
    expect(h.logs).toContainEqual({
      level: "warn",
      message: "resources.list_entries_dropped",
      fields: { app: "bender", type: "kirby:thread", dropped: 3 },
    })
  })
})
