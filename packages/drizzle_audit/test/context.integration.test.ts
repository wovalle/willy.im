import assert from "node:assert/strict"
import test from "node:test"

import { PGlite } from "@electric-sql/pglite"
import { asc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { pgTable, text } from "drizzle-orm/pg-core"

import {
  currentAudit,
  ensureAuditedTx,
  hasAuditContext,
  maybeCurrentAudit,
  runWithAuditContext,
} from "../src/context/index.js"
import {
  createAttachAuditTriggersSql,
  createAuditInstallSql,
  pgAuditLogTable,
} from "../src/postgres/index.js"

const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

const contextColumns = [{ column: "workspace_id" }]
const auditLogs = pgAuditLogTable({ contextColumns })

async function makeDb() {
  const client = new PGlite()
  const db = drizzle({ client })
  await client.exec(createAuditInstallSql({ contextColumns }))
  await client.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `)
  await client.exec(createAttachAuditTriggersSql([{ table: "users" }]))
  return db
}

test("ensureAuditedTx stamps the ambient actor + context columns", async () => {
  const db = await makeDb()

  await runWithAuditContext(
    { actorId: "user_123", context: { workspace_id: "ws_1" } },
    () =>
      ensureAuditedTx(db, async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Ada" })
        await tx.update(users).set({ name: "Ada Lovelace" }).where(eq(users.id, "u1"))
      }),
  )

  const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
  assert.equal(logs.length, 2)
  assert.equal(logs[0]?.operation, "INSERT")
  assert.equal(logs[0]?.user_id, "user_123")
  assert.equal((logs[0] as { workspace_id?: string }).workspace_id, "ws_1")
  assert.equal(logs[1]?.operation, "UPDATE")
  assert.equal(logs[1]?.user_id, "user_123")
})

test("nested ensureAuditedTx reuses one transaction (reentrant)", async () => {
  const db = await makeDb()

  let outerTx: unknown
  let innerTx: unknown

  await runWithAuditContext({ actorId: "user_42" }, () =>
    ensureAuditedTx(db, async (tx) => {
      outerTx = tx
      await tx.insert(users).values({ id: "a", name: "A" })
      // A nested unit (e.g. another service method) must reuse the open tx.
      await ensureAuditedTx(db, async (tx2) => {
        innerTx = tx2
        await tx2.insert(users).values({ id: "b", name: "B" })
      })
    }),
  )

  assert.equal(outerTx, innerTx, "nested call should reuse the same tx instance")
  const logs = await db.select().from(auditLogs)
  assert.equal(logs.length, 2)
  assert.ok(logs.every((l) => l.user_id === "user_42"))
})

test("lazy resolver runs once, on first write; currentAudit reads it", async () => {
  const db = await makeDb()

  let resolved = 0
  let seenActor: string | undefined

  await runWithAuditContext(
    () => {
      resolved++
      return { actorId: "lazy_user" }
    },
    async () => {
      // Not resolved yet — no write has happened.
      assert.equal(maybeCurrentAudit(), null)
      assert.equal(resolved, 0)

      await ensureAuditedTx(db, async (tx) => {
        seenActor = currentAudit().actorId
        await tx.insert(users).values({ id: "x", name: "X" })
        // Reentrant call must NOT resolve again.
        await ensureAuditedTx(db, async (tx2) => {
          await tx2.insert(users).values({ id: "y", name: "Y" })
        })
      })
    },
  )

  assert.equal(resolved, 1, "resolver runs exactly once")
  assert.equal(seenActor, "lazy_user")
})

test("guardrail: audited write / currentAudit outside a context throw", async () => {
  const db = await makeDb()

  assert.equal(hasAuditContext(), false)
  assert.throws(() => currentAudit(), /no ambient audit context/)
  await assert.rejects(
    () => ensureAuditedTx(db, async () => {}),
    /outside an audit context/,
  )
})
