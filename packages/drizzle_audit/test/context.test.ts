import assert from "node:assert/strict"
import test from "node:test"

import {
  currentAudit,
  ensureAuditedTx,
  hasAuditContext,
  maybeCurrentAudit,
  runWithAuditContext,
} from "../src/context/index.js"

// A minimal fake of the drizzle surface `ensureAuditedTx` needs: a
// transaction-capable db whose tx records the SQL passed to `execute` (which is
// how setAuditContext writes the actor/context GUCs). No real database — this
// exercises the ALS plumbing (resolution, reentrancy, guardrail) deterministically.
type FakeTx = { execute(query: unknown): Promise<unknown> }

function makeFakeDb() {
  let txCount = 0
  const executed: unknown[] = []
  const tx: FakeTx = {
    async execute(query: unknown) {
      executed.push(query)
      return undefined
    },
  }
  const db = {
    async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      txCount++
      return cb(tx)
    },
  }
  return {
    db,
    tx,
    executed,
    get txCount() {
      return txCount
    },
  }
}

test("ensureAuditedTx opens one tx and writes the actor GUC", async () => {
  const fake = makeFakeDb()
  let inside: unknown

  await runWithAuditContext({ actorId: "user_1" }, () =>
    ensureAuditedTx(fake.db, async (tx) => {
      inside = tx
    }),
  )

  assert.equal(fake.txCount, 1)
  assert.equal(inside, fake.tx)
  // setAuditContext ran at least the actor set_config.
  assert.ok(fake.executed.length >= 1)
})

test("nested ensureAuditedTx reuses the open tx (no second transaction)", async () => {
  const fake = makeFakeDb()
  const seen: unknown[] = []

  await runWithAuditContext({ actorId: "user_1" }, () =>
    ensureAuditedTx(fake.db, async (tx) => {
      seen.push(tx)
      await ensureAuditedTx(fake.db, async (tx2) => {
        seen.push(tx2)
        await ensureAuditedTx(fake.db, async (tx3) => seen.push(tx3))
      })
    }),
  )

  assert.equal(fake.txCount, 1, "only one transaction is opened")
  assert.equal(seen.length, 3)
  assert.ok(seen.every((t) => t === fake.tx))
})

test("lazy resolver runs exactly once, on first write", async () => {
  const fake = makeFakeDb()
  let resolved = 0
  let seenActor: string | undefined

  await runWithAuditContext(
    () => {
      resolved++
      return { actorId: "lazy" }
    },
    async () => {
      assert.equal(resolved, 0, "not resolved before any write")
      assert.equal(maybeCurrentAudit(), null)

      await ensureAuditedTx(fake.db, async () => {
        seenActor = currentAudit().actorId
        // reentrant — must not re-resolve
        await ensureAuditedTx(fake.db, async () => {})
      })

      // resolved value is memoised on the cell
      assert.equal(maybeCurrentAudit()?.actorId, "lazy")
    },
  )

  assert.equal(resolved, 1)
  assert.equal(seenActor, "lazy")
})

test("eager context resolves immediately (currentAudit before any write)", async () => {
  await runWithAuditContext(
    { actorId: "eager", context: { workspace_id: "ws_9" } },
    async () => {
      assert.equal(currentAudit().actorId, "eager")
      assert.equal(currentAudit().context?.["workspace_id"], "ws_9")
    },
  )
})

test("guardrail: writes / reads outside a context fail loudly", async () => {
  const fake = makeFakeDb()

  assert.equal(hasAuditContext(), false)
  assert.equal(maybeCurrentAudit(), null)
  assert.throws(() => currentAudit(), /no ambient audit context/)
  await assert.rejects(
    () => ensureAuditedTx(fake.db, async () => {}),
    /outside an audit context/,
  )
  assert.equal(fake.txCount, 0)
})

test("context is isolated per runWithAuditContext scope", async () => {
  const a = runWithAuditContext({ actorId: "A" }, async () => {
    await Promise.resolve()
    return currentAudit().actorId
  })
  const b = runWithAuditContext({ actorId: "B" }, async () => {
    await Promise.resolve()
    return currentAudit().actorId
  })
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"])
})
