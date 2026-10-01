import { describe, expect, test } from "vitest"
import { definePermissions } from "../src/index.js"
import { createPermissionsHook } from "../src/react.js"

const auth = definePermissions({
  permissions: ["posts:read", "posts:write", "postsx:read", "users:read", "inbox:read"],
  resources: ["thread", "inbox:thread"],
  roles: { editor: ["posts:read", "posts:write"], viewer: ["posts:read"] },
})

describe("roles", () => {
  test("a role grants exactly its permissions", () => {
    const viewer = auth.createChecker("viewer")
    expect(viewer.has("posts:read")).toBe(true)
    expect(viewer.has("posts:write")).toBe(false)
    expect(viewer.granted).toEqual(["posts:read"])
    expect(viewer.isSuperadmin).toBe(false)
  })

  test("a superadmin role grants everything", () => {
    const admin = auth.createChecker("viewer", { superadmin: true })
    expect(auth.permissions.every((p) => admin.has(p))).toBe(true)
    expect(admin.has("thread:abc")).toBe(true)
    expect(admin.granted).toEqual([...auth.permissions])
    expect(admin.isSuperadmin).toBe(true)
  })

  test("require throws a 403 Response", () => {
    const viewer = auth.createChecker("viewer")
    expect(() => viewer.require("posts:read")).not.toThrow()
    const err = (() => {
      try {
        viewer.require("posts:write")
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(Response)
    expect((err as Response).status).toBe(403)
  })
})

describe("grants", () => {
  test("listed catalog permissions are granted; unknown grants are dropped", () => {
    const c = auth.checkerFor([
      "posts:read",
      "billing:manage",
      "comments:*",
      "users:read",
      "posts:read",
    ])
    expect(c.granted).toEqual(["posts:read", "users:read"])
    expect(c.has("posts:write")).toBe(false)
  })

  test("`prefix:*` expands to the catalog permissions under that prefix only", () => {
    const c = auth.checkerFor(["posts:*"])
    expect(c.granted).toEqual(["posts:read", "posts:write"])
    expect(c.has("postsx:read")).toBe(false)
  })

  test("`*` is a superadmin", () => {
    const c = auth.checkerFor(["*"])
    expect(c.isSuperadmin).toBe(true)
    expect(c.has("users:read")).toBe(true)
    expect(c.has("thread:abc")).toBe(true)
    expect(c.granted).toEqual([...auth.permissions])
  })

  test("an instance grant passes for that instance of a declared resource only", () => {
    const c = auth.checkerFor(["thread:abc", "note:abc"])
    expect(c.has("thread:abc")).toBe(true)
    expect(c.has("thread:abd")).toBe(false)
    expect(c.has("note:abc" as never)).toBe(false)
    expect(c.granted).toEqual(["thread:abc"])
    expect(c.isSuperadmin).toBe(false)
  })

  test("a resource wildcard passes every instance, and a parent wildcard every nested one", () => {
    const thread = auth.checkerFor(["thread:*"])
    expect(thread.has("thread:abc")).toBe(true)
    expect(thread.has("inbox:thread:abc")).toBe(false)
    const inbox = auth.checkerFor(["inbox:*"])
    expect(inbox.has("inbox:read")).toBe(true)
    expect(inbox.has("inbox:thread:abc")).toBe(true)
    expect(inbox.has("thread:abc")).toBe(false)
  })

  test("malformed or look-alike grants grant nothing", () => {
    const c = auth.checkerFor([
      "thread:",
      "thread",
      "threads:abc",
      ":*",
      "*:",
      "thread:*x",
      "thread:a:b",
      "thread:a b",
    ])
    expect(c.granted).toEqual([])
    expect(c.has("thread:")).toBe(false)
    expect(c.has("thread:*")).toBe(false)
    expect(c.has("thread:abc")).toBe(false)
    expect(c.has("threads:abc" as never)).toBe(false)
  })
})

describe("usePermissions", () => {
  test("matches the way the server checker does: exact, wildcards, instances, superadmin", () => {
    const { granted, isSuperadmin } = auth.checkerFor(["posts:read", "thread:*", "inbox:thread:h1"])
    const perms = createPermissionsHook(() => ({ granted, isSuperadmin }))()
    expect(perms.has("posts:read")).toBe(true)
    expect(perms.has("posts:write")).toBe(false)
    expect(perms.has("thread:anything")).toBe(true)
    expect(perms.has("inbox:thread:h1")).toBe(true)
    expect(perms.has("inbox:thread:h2")).toBe(false)
    const admin = createPermissionsHook<string>(() => ({ granted: [], isSuperadmin: true }))()
    expect(admin.has("users:read")).toBe(true)
  })
})
