import { describe, expect, it } from "vitest"

import { avatarPath, avatarUrl } from "../app/lib/avatar"
import * as avatar from "../app/routes/avatar.$seed"

/**
 * The avatar route. It touches no database and no session, so the tests are
 * just Request in / Response out — which is also the point of the route.
 */

const get = (path: string, init?: RequestInit) =>
  avatar.loader({
    request: new Request(`https://idp.willy.im${path}`, init),
    params: { seed: decodeURIComponent(path.split("?")[0].replace("/avatar/", "")) },
    context: {},
  } as never) as Response

describe("avatar URLs", () => {
  it("seeds on the id and escapes it", () => {
    expect(avatarPath("usr_123")).toBe("/avatar/usr_123")
    expect(avatarPath("a/b?c")).toBe("/avatar/a%2Fb%3Fc")
  })

  it("carries an explicit size, and omits it otherwise", () => {
    expect(avatarPath("usr_123", { size: 64 })).toBe("/avatar/usr_123?size=64")
    expect(avatarUrl("https://idp.willy.im", "usr_123", { size: 64 })).toBe(
      "https://idp.willy.im/avatar/usr_123?size=64",
    )
  })
})

describe("GET /avatar/:seed", () => {
  it("renders SVG that can't execute anything", async () => {
    const res = get("/avatar/usr_123")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8")
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await res.text()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })

  it("is deterministic per seed, and different across seeds", async () => {
    const [a, b, c] = await Promise.all([
      get("/avatar/usr_123").text(),
      get("/avatar/usr_123").text(),
      get("/avatar/usr_456").text(),
    ])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it("caches, and answers a matching If-None-Match with 304", async () => {
    const first = get("/avatar/usr_123")
    expect(first.headers.get("cache-control")).toBe("public, max-age=604800")
    const etag = first.headers.get("etag")!
    expect(etag).toMatch(/^"[a-z0-9]+"$/)

    const second = get("/avatar/usr_123", { headers: { "if-none-match": etag } })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe("")

    // A different rendering is a different entity.
    expect(get("/avatar/usr_123?size=64").headers.get("etag")).not.toBe(etag)
  })

  it("bakes a default size, and honours an explicit one", async () => {
    expect(await get("/avatar/usr_123").text()).toContain('width="128" height="128"')
    expect(await get("/avatar/usr_123?size=64").text()).toContain('width="64" height="64"')
  })

  it("clamps nonsense rather than 400ing — this URL lives in an <img>", async () => {
    expect(await get("/avatar/usr_123?size=99999").text()).toContain('width="1024"')
    expect(await get("/avatar/usr_123?size=1").text()).toContain('width="8"')
    // Junk falls back to the default instead of poisoning the render.
    expect(await get("/avatar/usr_123?size=abc&hue=nope&tone=x").text()).toContain('width="128"')
    expect(get("/avatar/usr_123?expression=nonexistent").status).toBe(200)
  })

  it("locks the hue when asked, so the seed drives shape only", async () => {
    const [red, blue] = await Promise.all([
      get("/avatar/usr_123?hue=0").text(),
      get("/avatar/usr_123?hue=240").text(),
    ])
    expect(red).not.toBe(blue)
    // Same hue, different seeds — different figures, and neither is the other's colour.
    expect(await get("/avatar/usr_456?hue=0").text()).not.toBe(red)
  })

  it("takes a background, and `none` renders transparent", async () => {
    const circle = await get("/avatar/usr_123?background=circle").text()
    const none = await get("/avatar/usr_123?background=none").text()
    expect(circle).not.toBe(none)
    // The backdrop is the first path; without one there's nothing behind the figure.
    expect(none.length).toBeLessThan(circle.length)
  })

  it("escapes and truncates a caller-supplied title", async () => {
    const svg = await get(`/avatar/usr_123?title=${encodeURIComponent("<script>x</script>")}`).text()
    expect(svg).toContain("&lt;script&gt;")
    expect(svg).not.toContain("<script>")

    const long = await get(`/avatar/usr_123?title=${"a".repeat(500)}`).text()
    expect(long).toContain(`<title>${"a".repeat(128)}</title>`)
  })
})
