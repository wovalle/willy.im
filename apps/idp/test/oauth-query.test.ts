import { describe, expect, it } from "vitest"

import { staleAuthorizeUrl } from "../app/lib/oauth-query"

const NOW = 1_800_000_000_000

function signedQuery(exp: number, extra = "") {
  return (
    `?client_id=abc&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&scope=openid+email&state=s1` +
    `&exp=${exp}&ba_iat=${(exp - 600) * 1000}` +
    `&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=redirect_uri&ba_param=scope&ba_param=state` +
    `&sig=xyz${extra}`
  )
}

describe("staleAuthorizeUrl", () => {
  it("is null without a signed query", () => {
    expect(staleAuthorizeUrl("", NOW)).toBeNull()
    expect(staleAuthorizeUrl("?next=%2Fsettings", NOW)).toBeNull()
  })

  it("is null while the signed query is still good", () => {
    expect(staleAuthorizeUrl(signedQuery(NOW / 1000 + 300), NOW)).toBeNull()
  })

  it("restarts the authorize request once the signed query has expired", () => {
    const url = staleAuthorizeUrl(signedQuery(NOW / 1000 - 1, "&email=a%40b.test"), NOW)
    expect(url).not.toBeNull()
    const [path, query] = url!.split("?")
    expect(path).toBe("/auth/oauth2/authorize")
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      client_id: "abc",
      redirect_uri: "https://app.test/cb",
      scope: "openid email",
      state: "s1",
    })
  })

  it("treats a query about to expire as stale", () => {
    expect(staleAuthorizeUrl(signedQuery(NOW / 1000 + 10), NOW)).not.toBeNull()
  })
})
