import { describe, expect, it } from "vitest"

import { safeNext } from "../app/lib/next-url"

/**
 * `?next=` exists so bender can send someone to /link/discord and have them
 * land back there after the OTP round trip. It is also a redirect on the
 * domain that issues every session in the house, so the rejection cases are
 * the point of this file — an attacker-supplied `next` must never leave the
 * origin.
 */
describe("safeNext", () => {
  it("returns an ordinary in-app path", () => {
    expect(safeNext("?next=%2Flink%2Fdiscord")).toBe("/link/discord")
    expect(safeNext(new URLSearchParams({ next: "/account" }))).toBe("/account")
  })

  it("is null when there is nothing to honour", () => {
    expect(safeNext("")).toBeNull()
    expect(safeNext("?next=")).toBeNull()
    expect(safeNext("?email=hey%40willy.im")).toBeNull()
  })

  it("refuses an absolute URL — that is the open redirect", () => {
    expect(safeNext("?next=https%3A%2F%2Fevil.test")).toBeNull()
    expect(safeNext("?next=http%3A%2F%2Fevil.test%2Fx")).toBeNull()
  })

  it("refuses a protocol-relative URL, which browsers treat as absolute", () => {
    // "//evil.test" is not a path. It is the single most-missed case here.
    expect(safeNext("?next=%2F%2Fevil.test")).toBeNull()
    expect(safeNext("?next=%2F%2Fevil.test%2Fcallback")).toBeNull()
  })

  it("refuses a backslash-escaped host, the protocol-relative case in a hat", () => {
    expect(safeNext("?next=%2F%5Cevil.test")).toBeNull()
  })

  it("refuses anything that is not rooted at /", () => {
    expect(safeNext("?next=account")).toBeNull()
    expect(safeNext("?next=javascript%3Aalert(1)")).toBeNull()
  })
})
