import assert from "node:assert/strict"
import v8 from "node:v8"
import vm from "node:vm"
import { test } from "vitest"

import {
  currentAudit,
  ensureAuditedTx,
  hasAuditContext,
  maybeCurrentAudit,
  runWithAuditContext,
} from "../../src/audit/context/index.js"

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

// What workerd does: the ALS store stays reachable after the request ends (here, a
// pending timer created inside the scope holds it). The resolver closes over the
// request; once fn settles it must not keep the request alive through the store.
// Each piece lives in its own function so that no closure but the resolver can
// reach the request (V8 closures share their enclosing scope's context).
const noop = () => {}
let pending: ReturnType<typeof setTimeout> | undefined
/** A request-scoped unit of work with a lazy resolver; returns only a WeakRef to the request. */
async function requestScopeLeavingTheStoreReachable() {
  const request = { body: new Array(100_000).fill("x") }
  const ref = new WeakRef(request)
  await runWithAuditContext(
    () => ({ actorId: `user_${request.body.length}` }),
    async () => {
      pending = setTimeout(noop, 60_000) // keeps this scope's ALS store alive
    },
  )
  return ref
}

test("a lazy resolver is unreachable from the store once fn settles", async () => {
  v8.setFlagsFromString("--expose-gc")
  const gc = vm.runInNewContext("gc") as () => void
  const ref = await requestScopeLeavingTheStoreReachable()
  for (let i = 0; i < 3 && ref.deref(); i++) {
    await new Promise((r) => setImmediate(r))
    gc()
  }
  clearTimeout(pending)
  assert.equal(ref.deref(), undefined, "the request was retained through the audit store")
})

test("a write that outlives the scope uses the actor resolved inside it", async () => {
  const { db, executed } = makeFakeDb()
  let afterScope: Promise<unknown> | undefined
  await runWithAuditContext({ actorId: "eager" }, async () => {
    afterScope = new Promise((r) => setTimeout(r, 0)).then(() =>
      ensureAuditedTx(db, async () => currentAudit().actorId),
    )
  })
  assert.equal(await afterScope, "eager")
  assert.ok(executed.length > 0)
})

test("a write that outlives the scope without a resolved actor fails loudly", async () => {
  const { db } = makeFakeDb()
  let afterScope: Promise<unknown> | undefined
  await runWithAuditContext(
    () => ({ actorId: "lazy" }),
    async () => {
      afterScope = new Promise((r) => setTimeout(r, 0)).then(() => ensureAuditedTx(db, async () => 1))
    },
  )
  await assert.rejects(afterScope!, /the scope has ended/)
})

test("a synchronous fn releases the resolver too, and a throwing one rethrows", () => {
  assert.equal(runWithAuditContext(() => ({ actorId: "x" }), () => 42), 42)
  assert.throws(
    () =>
      runWithAuditContext(
        () => ({ actorId: "x" }),
        () => {
          throw new Error("boom")
        },
      ),
    /boom/,
  )
})
