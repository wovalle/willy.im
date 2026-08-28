import { describe, expect, it } from "vitest"

import { serverEventName } from "luchy/react-router"

import { LUCHY_TRACKER_OPTIONS } from "../app/lib/luchy.server"

/**
 * The generic derivation mechanics are tested inside the `luchy` package.
 * These tests pin the IdP's configuration of it: what our knobs actually
 * produce for our routes.
 */
describe("IdP tracker configuration", () => {
  const name = (input: Parameters<typeof serverEventName>[0]) =>
    serverEventName(input, LUCHY_TRACKER_OPTIONS)

  it("names console mutations route:intent", () => {
    expect(
      name({
        method: "POST",
        pathname: "/apps/kasso.data",
        status: 200,
        intent: "invite-member",
      }),
    ).toBe("apps/kasso:invite-member")
  })

  it("suffixes intent-less API mutations with the method", () => {
    expect(name({ method: "DELETE", pathname: "/api/v1/admin-keys/12345", status: 200 })).toBe(
      "api/v1/admin-keys/:id:delete",
    )
    expect(name({ method: "POST", pathname: "/api/v1/applications", status: 201 })).toBe(
      "api/v1/applications:post",
    )
  })

  it("tracks auth verbs, including failures", () => {
    expect(name({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 200 })).toBe(
      "auth/sign-in/email-otp:post",
    )
    expect(name({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 401 })).toBe(
      "auth/sign-in/email-otp:post",
    )
  })

  it("drops key-validation plumbing for every app key", () => {
    expect(
      name({ method: "POST", pathname: "/api/v1/apps/luchy/user-keys/validate", status: 200 }),
    ).toBeNull()
    expect(
      name({ method: "POST", pathname: "/api/v1/apps/kasso/user-keys/validate", status: 200 }),
    ).toBeNull()
  })

  it("still ignores reads and the manifest", () => {
    expect(name({ method: "GET", pathname: "/applications", status: 200 })).toBeNull()
    expect(name({ method: "POST", pathname: "/__manifest", status: 200 })).toBeNull()
  })
})
