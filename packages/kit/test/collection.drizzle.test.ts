import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { describe, expect, test } from "vitest"
import { z } from "zod"
import { cursorWhere, orderFor } from "../src/collection/drizzle.js"
import { collection, createApp, declareService } from "../src/index.js"
import { auth, context } from "./fixture.js"

const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  score: integer("score").notNull(),
  last: text("last").notNull(),
  first: text("first").notNull(),
})

// Ties everywhere: four rows share score 3; "Diaz" ties on `last` alone, "Diaz Ana" on the whole
// name. With pages of 2, page boundaries fall inside every tie group.
const seed = [
  { id: 1, score: 3, last: "Diaz", first: "Ana" },
  { id: 2, score: 1, last: "Bosch", first: "Juan" },
  { id: 3, score: 3, last: "Diaz", first: "Ana" },
  { id: 4, score: 2, last: "Diaz", first: "Luis" },
  { id: 5, score: 3, last: "Abreu", first: "Eva" },
  { id: 6, score: 1, last: "Diaz", first: "Ana" },
  { id: 7, score: 3, last: "Bosch", first: "Juan" },
  { id: 8, score: 2, last: "Cruz", first: "Rosa" },
]

const sqlite = new Database(":memory:")
sqlite.exec(
  "CREATE TABLE people (id INTEGER PRIMARY KEY, score INTEGER NOT NULL, last TEXT NOT NULL, first TEXT NOT NULL)",
)
const db = drizzle({ client: sqlite })
db.insert(people).values(seed).run()

const svc = declareService(() => ({
  list: collection({
    summary: "List people.",
    permission: "notes:read",
    row: z.object({ id: z.int(), score: z.int(), last: z.string(), first: z.string() }),
    fields: { default: ["id"] },
    sorts: {
      score: { dir: "desc", key: (r) => r.score },
      name: { dir: "asc", key: (r) => [r.last, r.first] },
    },
    defaultSort: "score",
    limit: { default: 2, max: 10 },
    load: ({ sort, dir, after, limit }) => {
      const columns =
        sort === "score" ? [people.score, people.id] : [people.last, people.first, people.id]
      const rows = db
        .select()
        .from(people)
        .where(cursorWhere(columns, after, dir))
        .orderBy(...orderFor(columns, dir))
        .limit(limit)
        .all()
      return { rows }
    },
  }),
}))
const app = createApp({ auth, context, services: { people: svc } } as never) as any
const ctx = await app.context(
  { id: "u", grants: [], memberships: [{ tenantId: "w1", grants: ["notes:read"] }] },
  "w1",
)

type Person = (typeof seed)[number]
const cmp = (a: unknown[], b: unknown[]) => {
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i] as string | number, b[i] as string | number]
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
const position = {
  score: (p: Person) => [p.score, p.id],
  name: (p: Person) => [p.last, p.first, p.id],
}
const expected = (sort: "score" | "name", dir: "asc" | "desc") =>
  [...seed]
    .sort((a, b) => cmp(position[sort](a), position[sort](b)) * (dir === "asc" ? 1 : -1))
    .map((p) => p.id)

async function walk(input: object) {
  const ids: number[] = []
  let next: unknown = input
  while (next) {
    const page = await ctx.services.people.list(next)
    ids.push(...page.rows.map((r: { id: number }) => r.id))
    next = page.next
  }
  return ids
}

describe("collection/drizzle", () => {
  for (const sort of ["score", "name"] as const)
    for (const dir of ["asc", "desc"] as const)
      test(`walking next to null returns every row once, in order: ${sort} key, ${dir}`, async () => {
        expect(await walk({ sort, dir })).toEqual(expected(sort, dir))
      })

  test("cursorWhere is undefined on the first page", () => {
    expect(cursorWhere([people.score, people.id], null, "desc")).toBeUndefined()
  })

  test("cursorWhere throws unless there is one column per key part, plus the id", () => {
    expect(() => cursorWhere([people.score], { key: 3, id: 1 }, "desc")).toThrow(
      /needs 2 columns.*got 1/,
    )
    expect(() =>
      cursorWhere([people.last, people.id], { key: ["Diaz", "Ana"], id: 1 }, "asc"),
    ).toThrow(/needs 3 columns.*got 2/)
  })
})
