import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { definePermissions } from "../src/define-permissions.js"

const auth = definePermissions({
  permissions: [
    "posts:read",
    "posts:write",
    "posts:delete",
    "users:read",
    "users:manage",
  ] as const,
  roles: {
    admin: ["posts:read", "posts:write", "posts:delete", "users:read", "users:manage"],
    editor: ["posts:read", "posts:write", "users:read"],
    viewer: ["posts:read", "users:read"],
  },
})

describe("definePermissions", () => {
  it("exposes the original permissions and roles", () => {
    assert.deepEqual(auth.permissions, [
      "posts:read",
      "posts:write",
      "posts:delete",
      "users:read",
      "users:manage",
    ])
    assert.deepEqual(Object.keys(auth.roles), ["admin", "editor", "viewer"])
  })
})

describe("createChecker", () => {
  it("has() returns true for granted permissions", () => {
    const checker = auth.createChecker("editor")
    assert.equal(checker.has("posts:read"), true)
    assert.equal(checker.has("posts:write"), true)
    assert.equal(checker.has("users:read"), true)
  })

  it("has() returns false for denied permissions", () => {
    const checker = auth.createChecker("editor")
    assert.equal(checker.has("posts:delete"), false)
    assert.equal(checker.has("users:manage"), false)
  })

  it("granted contains exactly the role permissions", () => {
    const checker = auth.createChecker("viewer")
    assert.deepEqual(checker.granted, ["posts:read", "users:read"])
  })

  it("admin has all permissions", () => {
    const checker = auth.createChecker("admin")
    for (const p of auth.permissions) {
      assert.equal(checker.has(p), true, `admin should have ${p}`)
    }
  })

  it("require() does not throw for granted permissions", () => {
    const checker = auth.createChecker("editor")
    assert.doesNotThrow(() => checker.require("posts:read"))
    assert.doesNotThrow(() => checker.require("posts:write"))
  })

  it("require() throws a 403 Response for denied permissions", () => {
    const checker = auth.createChecker("viewer")
    try {
      checker.require("posts:delete")
      assert.fail("should have thrown")
    } catch (err) {
      assert.ok(err instanceof Response)
      assert.equal((err as Response).status, 403)
    }
  })

  it("different roles are isolated from each other", () => {
    const admin = auth.createChecker("admin")
    const viewer = auth.createChecker("viewer")

    assert.equal(admin.has("posts:delete"), true)
    assert.equal(viewer.has("posts:delete"), false)

    assert.equal(admin.has("users:manage"), true)
    assert.equal(viewer.has("users:manage"), false)
  })
})

describe("edge cases", () => {
  it("works with a role that has no permissions", () => {
    const empty = definePermissions({
      permissions: ["a", "b"] as const,
      roles: { none: [] },
    })

    const checker = empty.createChecker("none")
    assert.equal(checker.has("a"), false)
    assert.equal(checker.has("b"), false)
    assert.deepEqual(checker.granted, [])
  })

  it("works with a single permission and single role", () => {
    const minimal = definePermissions({
      permissions: ["only"] as const,
      roles: { sole: ["only"] },
    })

    const checker = minimal.createChecker("sole")
    assert.equal(checker.has("only"), true)
    assert.deepEqual(checker.granted, ["only"])
  })
})
