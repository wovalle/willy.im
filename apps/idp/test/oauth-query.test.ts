import { describe, expect, it } from "vitest"

import { authErrorText } from "../app/lib/auth-client"
import { signedQueryExpired, withoutSignedQuery } from "../app/lib/oauth-query"

const NOW = 1_800_000_000_000

function signedQuery(exp: number, extra = "") {
  return (
    `?client_id=abc&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&scope=openid&state=s1` +
    `&exp=${exp}&ba_iat=${(exp - 600) * 1000}&ba_param=client_id&ba_param=exp&sig=xyz${extra}`
  )
}

describe("signedQueryExpired", () => {
  it("is false without a signed query", () => {
    expect(signedQueryExpired("", NOW)).toBe(false)
    expect(signedQueryExpired("?next=%2Fsettings", NOW)).toBe(false)
  })

  it("is false while the signed query is still good", () => {
    expect(signedQueryExpired(signedQuery(NOW / 1000 + 300), NOW)).toBe(false)
  })

  it("is true once it has expired, or is about to", () => {
    expect(signedQueryExpired(signedQuery(NOW / 1000 - 1), NOW)).toBe(true)
    expect(signedQueryExpired(signedQuery(NOW / 1000 + 10), NOW)).toBe(true)
  })

  it("is true when exp is missing or garbage", () => {
    expect(signedQueryExpired("?client_id=abc&sig=xyz", NOW)).toBe(true)
    expect(signedQueryExpired("?exp=soon&sig=xyz", NOW)).toBe(true)
  })
})

describe("withoutSignedQuery", () => {
  it("keeps only the login page's own params", () => {
    expect(withoutSignedQuery(signedQuery(NOW / 1000, "&email=a%40b.test&next=%2Fsettings"))).toBe(
      "?email=a%40b.test&next=%2Fsettings",
    )
  })

  it("is empty when nothing of ours is left", () => {
    expect(withoutSignedQuery(signedQuery(NOW / 1000))).toBe("")
  })
})

describe("authErrorText", () => {
  it("prefers the server's message", () => {
    expect(authErrorText({ message: "Too many requests", status: 429 }, "Failed.")).toBe("Too many requests")
  })

  it("names an expired authorize request", () => {
    expect(authErrorText({ error: "invalid_signature", status: 400 }, "Failed.")).toMatch(/expired/)
  })

  it("keeps the cause next to the fallback", () => {
    expect(authErrorText({ code: "SOME_CODE", status: 400 }, "Failed.")).toBe("Failed. (SOME_CODE)")
    expect(authErrorText({ status: 502, statusText: "Bad Gateway" }, "Failed.")).toBe("Failed. (502 Bad Gateway)")
    expect(authErrorText({}, "Failed.")).toBe("Failed.")
  })
})
