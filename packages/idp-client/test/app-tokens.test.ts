import { describe, expect, it } from "vitest"

import { createAppTokens } from "../src/app-tokens.js"
import { IdpError } from "../src/index.js"

/**
 * The admin-key side of app tokens, against a fake IdP: what a mint sends, and
 * the cache that keeps one token per (app, scopes, workspace) until a minute
 * before it expires.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const START = Date.parse("2026-06-01T00:00:00.000Z")
const MINUTE = 60_000

/**
 * An IdP that mints `wat_1`, `wat_2`… each living an hour on the test clock.
 * `answer` overrides the response; `held` keeps every request waiting on it.
 */
function tokensFor(options: { answer?: () => Response | null; held?: Promise<void> } = {}) {
  const seen: Request[] = []
  let clock = START
  let minted = 0
  const tokens = createAppTokens({
    baseUrl: "https://idp.test",
    token: "wim_admin",
    now: () => clock,
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init)
      seen.push(request)
      await options.held
      const override = options.answer?.()
      if (override) return override
      const body = (await request.clone().json()) as { scopes?: string[]; workspaceId?: string }
      minted++
      return json(
        {
          id: `t_${minted}`,
          token: `wat_${minted}`,
          prefix: `wat_${minted}`,
          scopes: body.scopes ?? ["*"],
          workspaceId: body.workspaceId ?? null,
          expiresAt: new Date(clock + 60 * MINUTE).toISOString(),
        },
        201,
      )
    },
  })
  return { tokens, seen, advance: (ms: number) => (clock += ms) }
}

describe("createAppTokens", () => {
  it("mints at the IdP with the admin key, for the app it is asked about", async () => {
    const { tokens, seen } = tokensFor()

    expect(await tokens.get("invoices")).toEqual({
      token: "wat_1",
      expiresAt: "2026-06-01T01:00:00.000Z",
    })
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.url).toBe("https://idp.test/apps/invoices/api/app_tokens.mint")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer wim_admin")
    // Nothing narrowed: the IdP's default, ["*"], applies.
    expect(await seen[0]?.clone().json()).toEqual({})
  })

  it("sends narrowed scopes and a workspace binding, and leaves out the signal", async () => {
    const { tokens, seen } = tokensFor()
    await tokens.get("invoices", {
      scopes: ["clients:read"],
      workspaceId: "w_1",
      signal: new AbortController().signal,
    })

    expect(await seen[0]?.clone().json()).toEqual({ scopes: ["clients:read"], workspaceId: "w_1" })
  })

  it("reuses a token until a minute before it expires, then mints a fresh one", async () => {
    const { tokens, seen, advance } = tokensFor()

    expect((await tokens.get("invoices")).token).toBe("wat_1")
    advance(58 * MINUTE)
    expect((await tokens.get("invoices")).token).toBe("wat_1")
    expect(seen).toHaveLength(1)

    advance(MINUTE)
    expect((await tokens.get("invoices")).token).toBe("wat_2")
    expect(seen).toHaveLength(2)
  })

  it("keeps one token per app, scope set and workspace", async () => {
    const { tokens, seen } = tokensFor()

    // Omitted scopes are ["*"], and a scope set is the same in any order.
    await tokens.get("invoices")
    await tokens.get("invoices", { scopes: ["*"] })
    await tokens.get("invoices", { scopes: ["b:read", "a:read"] })
    await tokens.get("invoices", { scopes: ["a:read", "b:read", "a:read"] })
    expect(seen).toHaveLength(2)

    await tokens.get("bender")
    await tokens.get("invoices", { workspaceId: "w_1" })
    expect(seen).toHaveLength(4)
  })

  it("shares one in-flight mint between concurrent callers", async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const { tokens, seen } = tokensFor({ held })

    const pending = Promise.all([
      tokens.get("invoices"),
      tokens.get("invoices"),
      tokens.get("invoices"),
    ])
    release()

    const [a, b, c] = await pending
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(seen).toHaveLength(1)
  })

  it("does not cache a failed mint", async () => {
    let refuse = true
    const { tokens, seen } = tokensFor({
      answer: () => (refuse ? json({ error: "forbidden" }, 403) : null),
    })

    const failure = await tokens.get("invoices").catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(IdpError)
    expect(failure).toMatchObject({ status: 403, body: { error: "forbidden" } })
    refuse = false
    expect((await tokens.get("invoices")).token).toBe("wat_1")
    expect(seen).toHaveLength(2)
  })
})
