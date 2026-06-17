import assert from "node:assert/strict"
import test from "node:test"

import { computeDiff } from "../src/compute-diff.js"

test("UPDATE — only changed fields are emitted", () => {
  const result = computeDiff(
    "UPDATE",
    { name: "Juan", phone: "809", status: "current" },
    { name: "Juan Carlos", phone: "809", status: "current" },
  )
  assert.deepEqual(result, {
    operation: "UPDATE",
    changes: [{ field: "name", old: "Juan", new: "Juan Carlos" }],
  })
})

test("UPDATE — ignores updated_at by default", () => {
  const result = computeDiff(
    "UPDATE",
    { name: "A", updated_at: "2026-01-01" },
    { name: "B", updated_at: "2026-04-15" },
  )
  assert.deepEqual(result, {
    operation: "UPDATE",
    changes: [{ field: "name", old: "A", new: "B" }],
  })
})

test("UPDATE — ignores created_at by default", () => {
  const result = computeDiff(
    "UPDATE",
    { name: "A", created_at: "2026-01-01" },
    { name: "A", created_at: "2026-04-15" },
  )
  assert.deepEqual(result, { operation: "UPDATE", changes: [] })
})

test("INSERT — all fields with old: null", () => {
  const result = computeDiff("INSERT", null, { name: "María", phone: "809" })
  assert.deepEqual(result, {
    operation: "INSERT",
    changes: [
      { field: "name", old: null, new: "María" },
      { field: "phone", old: null, new: "809" },
    ],
  })
})

test("DELETE — all fields with new: null", () => {
  const result = computeDiff("DELETE", { name: "Pedro", phone: "809" }, null)
  assert.deepEqual(result, {
    operation: "DELETE",
    changes: [
      { field: "name", old: "Pedro", new: null },
      { field: "phone", old: "809", new: null },
    ],
  })
})

test("custom ignoreFields", () => {
  const result = computeDiff("UPDATE", { a: 1, b: 2 }, { a: 1, b: 3 }, { ignoreFields: ["b"] })
  assert.deepEqual(result, { operation: "UPDATE", changes: [] })
})

test("deep equality for nested objects", () => {
  const result = computeDiff(
    "UPDATE",
    { payload: { x: 1 } },
    { payload: { x: 2 } },
  )
  assert.deepEqual(result, {
    operation: "UPDATE",
    changes: [{ field: "payload", old: { x: 1 }, new: { x: 2 } }],
  })
})

test("both null — returns empty changes", () => {
  const result = computeDiff("UPDATE", null, null)
  assert.deepEqual(result, { operation: "UPDATE", changes: [] })
})

test("changes are sorted alphabetically by field", () => {
  const result = computeDiff(
    "UPDATE",
    { zebra: 1, apple: 2, mango: 3 },
    { zebra: 2, apple: 3, mango: 4 },
  )
  assert.deepEqual(
    result.changes.map((c) => c.field),
    ["apple", "mango", "zebra"],
  )
})
