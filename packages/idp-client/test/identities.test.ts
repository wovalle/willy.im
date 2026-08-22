import { describe, expect, it } from "vitest"

import { createIdentities } from "../src/identities.js"

/**
 * The identities client, against a fake IdP: the path it hits, how it caches,
 * and that a failed round trip is never remembered.
 */

type Seen = { url: string; method: string; headers: Headers }

function fakeIdp(
  answer: (provider: string, externalId: string) => unknown,
  opts: { fail?: boolean } = {},
) {
  const seen: Seen[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    seen.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) })
    if (opts.fail) return new Response("boom", { status: 503 })
    const m = /\/identities\/([^/]+)\/([^/]+)$/.exec(new URL(url).pathname)!
    return Response.json(answer(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)))
  }
  return { seen, fetch: fetchImpl }
}

const willy = { found: true, userId: "u_willy", email: "hey@willy.im", name: "Willy", permissions: ["*"] }

describe("createIdentities", () => {
  it("resolves through the app-scoped endpoint with the app's own key", async () => {
    const idp = fakeIdp((p, e) => (p === "slack" && e === "U1" ? willy : { found: false }))
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })

    const res = await ids.resolve("slack", "U1")
    expect(res).toEqual(willy)
    expect(new URL(idp.seen[0]!.url).pathname).toBe("/api/v1/apps/bender/identities/slack/U1")
    expect(idp.seen[0]!.headers.get("authorization")).toBe("Bearer wim_x")
  })

  it("normalises the provider on the wire, so Slack and slack are one entry", async () => {
    const idp = fakeIdp(() => willy)
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })
    await ids.resolve(" Slack ", "U1")
    await ids.resolve("slack", "U1")
    expect(idp.seen).toHaveLength(1)
    expect(new URL(idp.seen[0]!.url).pathname).toBe("/api/v1/apps/bender/identities/slack/U1")
  })

  it("caches hits and misses, with separate TTLs", async () => {
    let clock = 0
    const idp = fakeIdp((_, e) => (e === "U1" ? willy : { found: false }))
    const ids = createIdentities({
      baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch,
      cache: { ttlMs: 1000, missTtlMs: 100 }, now: () => clock,
    })

    await ids.resolve("slack", "U1")
    await ids.resolve("slack", "U1")
    await ids.resolve("slack", "U_NOBODY")
    await ids.resolve("slack", "U_NOBODY")
    expect(idp.seen).toHaveLength(2)

    clock = 150 // the miss has expired, the hit has not
    await ids.resolve("slack", "U1")
    await ids.resolve("slack", "U_NOBODY")
    expect(idp.seen).toHaveLength(3)
  })

  it("collapses concurrent lookups of the same pair into one round trip", async () => {
    const idp = fakeIdp(() => willy)
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })
    await Promise.all([ids.resolve("slack", "U1"), ids.resolve("slack", "U1"), ids.resolve("slack", "U1")])
    expect(idp.seen).toHaveLength(1)
  })

  it("never caches a failed round trip", async () => {
    const idp = fakeIdp(() => willy, { fail: true })
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })
    await expect(ids.resolve("slack", "U1")).rejects.toThrow()
    await expect(ids.resolve("slack", "U1")).rejects.toThrow()
    // Two attempts, two requests — an IdP blip must not lock anyone out for a TTL.
    expect(idp.seen).toHaveLength(2)
  })

  it("forget() drops one pair, or everything", async () => {
    const idp = fakeIdp(() => willy)
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })
    await ids.resolve("slack", "U1")
    ids.forget("slack", "U1")
    await ids.resolve("slack", "U1")
    expect(idp.seen).toHaveLength(2)
    ids.forget()
    await ids.resolve("slack", "U1")
    expect(idp.seen).toHaveLength(3)
  })

  it("an empty id is a miss without a round trip", async () => {
    const idp = fakeIdp(() => willy)
    const ids = createIdentities({ baseUrl: "https://idp.test", token: "wim_x", app: "bender", fetch: idp.fetch })
    expect(await ids.resolve("slack", "")).toEqual({ found: false })
    expect(idp.seen).toHaveLength(0)
  })
})
