import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getAppEnv } from "../app/lib/env"

/**
 * The env schema fails closed on the signing secret. `BETTER_AUTH_SECRET` signs
 * session cookies and the OAuth authorize query and ENCRYPTS the OIDC private
 * keys stored in D1, so a missing one in production must stop the boot rather
 * than silently fall back to the committed dev value.
 */
describe("getAppEnv — BETTER_AUTH_SECRET", () => {
  const saved = new Map<string, string | undefined>()
  const set = (key: string, value: string | undefined) => {
    if (!saved.has(key)) saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  beforeEach(() => {
    set("BETTER_AUTH_URL", "https://idp.willy.im")
  })
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    saved.clear()
  })

  it("rejects a missing secret in production", () => {
    set("APP_ENV", "production")
    set("BETTER_AUTH_SECRET", undefined)
    expect(() => getAppEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("rejects the dev fallback secret in production", () => {
    set("APP_ENV", "production")
    set("BETTER_AUTH_SECRET", "dev-insecure-secret-change-me")
    expect(() => getAppEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("rejects a too-short secret in production", () => {
    set("APP_ENV", "production")
    set("BETTER_AUTH_SECRET", "short")
    expect(() => getAppEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("accepts a strong secret in production", () => {
    set("APP_ENV", "production")
    set("BETTER_AUTH_SECRET", "x".repeat(40))
    expect(getAppEnv("BETTER_AUTH_SECRET")).toHaveLength(40)
  })

  it("keeps the zero-config dev fallback outside production", () => {
    set("APP_ENV", "development")
    set("BETTER_AUTH_SECRET", undefined)
    expect(getAppEnv("APP_ENV")).toBe("development")
    expect(getAppEnv("BETTER_AUTH_SECRET")).toBe("dev-insecure-secret-change-me")
  })
})
