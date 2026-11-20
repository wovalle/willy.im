import { describe, expect, it } from "vitest"

import { safeNext } from "../src/index.js"

/**
 * `safeNext` decides where the auth callback sends someone after sign-in, so
 * anything it lets through becomes a `Location` header. The rejection cases
 * are the point: browsers turn `/\evil` into `//evil`, strip tabs before
 * parsing, and some code downstream decodes once more — each of those is an
 * open redirect if it slips past.
 */
describe("safeNext", () => {
  it.each(["/ok", "/ok?x=1#y", "/clientes/1", "/", "/a/b?next=%2Fc"])(
    "keeps the same-origin path %j",
    (next) => {
      expect(safeNext(next)).toBe(next)
    },
  )

  it.each([
    ["a backslash host", "/\\evil.example"],
    ["a percent-encoded backslash host", "/%5Cevil.example"],
    ["a lowercase percent-encoded backslash", "/%5cevil.example"],
    ["a backslash further in", "/ok\\..\\evil"],
    ["a protocol-relative URL", "//evil.example"],
    ["a percent-encoded protocol-relative URL", "/%2F%2Fevil.example"],
    ["a percent-encoded protocol-relative URL, second slash only", "/%2Fevil.example"],
    ["a percent-encoded tab before the host", "/%09/evil.example"],
    ["a raw tab before the host", "/\t/evil.example"],
    ["a raw newline before the host", "/\n/evil.example"],
    ["a raw space", "/ /evil.example"],
    ["a percent-encoded NUL", "/%00/evil.example"],
    ["DEL", "/\u007f/evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["an absolute URL to a path", "https://evil.example/ok"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "ok"],
    ["malformed percent-encoding", "/%E0%A4%A"],
  ])("drops %s", (_, next) => {
    expect(safeNext(next)).toBeUndefined()
  })

  it("is undefined when there is nothing to honour", () => {
    expect(safeNext(undefined)).toBeUndefined()
    expect(safeNext(null)).toBeUndefined()
    expect(safeNext("")).toBeUndefined()
  })
})
