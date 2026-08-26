import { describe, expect, it } from "vitest"

import { carriesIntent, normalizeRoute, serverEventName } from "../app/lib/luchy"

describe("normalizeRoute", () => {
  it("maps the root to home", () => {
    expect(normalizeRoute("/")).toBe("home")
    expect(normalizeRoute("/_root.data")).toBe("home")
  })

  it("keeps human segments and short app keys intact", () => {
    expect(normalizeRoute("/applications")).toBe("applications")
    expect(normalizeRoute("/api/v1/apps/luchy/keys")).toBe("api/v1/apps/luchy/keys")
  })

  it("collapses opaque id segments", () => {
    expect(normalizeRoute("/users/k9GJx2mPqR8sT4vWyZ01/identities")).toBe("users/:id/identities")
    expect(normalizeRoute("/apps/42")).toBe("apps/:id")
    expect(normalizeRoute("/apps/0198c1c2-9d7a-7000-8000-000000000000")).toBe("apps/:id")
  })

  it("strips the single-fetch .data suffix", () => {
    expect(normalizeRoute("/applications.data")).toBe("applications")
  })
})

describe("serverEventName", () => {
  it("names console mutations route:intent", () => {
    expect(
      serverEventName({
        method: "POST",
        pathname: "/apps/kasso.data",
        status: 200,
        intent: "invite-member",
      }),
    ).toBe("apps/kasso:invite-member")
  })

  it("falls back to the lowercased method when there is no intent", () => {
    expect(
      serverEventName({ method: "DELETE", pathname: "/api/v1/admin-keys/12345", status: 200 }),
    ).toBe("api/v1/admin-keys/:id:delete")
    expect(serverEventName({ method: "POST", pathname: "/api/v1/applications", status: 201 })).toBe(
      "api/v1/applications:post",
    )
  })

  it("tracks auth verbs by path", () => {
    expect(
      serverEventName({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 200 }),
    ).toBe("auth/sign-in/email-otp:post")
  })

  it("keeps failures (status rides in the payload, not the gate)", () => {
    expect(serverEventName({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 401 })).toBe(
      "auth/sign-in/email-otp:post",
    )
  })

  it("ignores reads and machine traffic", () => {
    expect(serverEventName({ method: "GET", pathname: "/applications", status: 200 })).toBeNull()
    expect(serverEventName({ method: "POST", pathname: "/__manifest", status: 200 })).toBeNull()
    expect(
      serverEventName({
        method: "POST",
        pathname: "/api/v1/apps/luchy/user-keys/validate",
        status: 200,
      }),
    ).toBeNull()
  })

  it("treats a junk intent as absent instead of minting event names", () => {
    expect(
      serverEventName({
        method: "POST",
        pathname: "/apps/kasso",
        status: 200,
        intent: "x".repeat(200),
      }),
    ).toBe("apps/kasso:post")
    expect(
      serverEventName({
        method: "POST",
        pathname: "/apps/kasso",
        status: 200,
        intent: "weird intent!",
      }),
    ).toBe("apps/kasso:post")
  })
})

describe("carriesIntent", () => {
  it("only urlencoded bodies are parsed for intent", () => {
    expect(carriesIntent("application/x-www-form-urlencoded")).toBe(true)
    expect(carriesIntent("application/x-www-form-urlencoded; charset=utf-8")).toBe(true)
    expect(carriesIntent("application/json")).toBe(false)
    expect(carriesIntent("multipart/form-data; boundary=x")).toBe(false)
    expect(carriesIntent(null)).toBe(false)
  })
})
