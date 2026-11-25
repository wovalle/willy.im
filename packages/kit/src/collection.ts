import { z } from "zod"
import { invalidInput, method, toSchema } from "./method.js"
import {
  META,
  type Contract,
  type Loads,
  type MethodMeta,
  type SchemaLike,
  type SchemaOf,
} from "./types.js"

/** A sort direction. */
export type Dir = "asc" | "desc"

type Scalar = string | number | boolean | null
/** What a sort key may be: JSON scalars, or a tuple of them. A `Date` must be turned into an ISO string. */
export type SortKey = Scalar | readonly Scalar[]

/** One sort a collection offers: its default direction, and the row's value it orders by. */
export type SortDef<Row> = {
  dir: Dir
  /** The row's position in this order. It goes into the cursor, so it must survive JSON. */
  key: (row: Row) => SortKey
}

type RowSchema = z.ZodObject
type RowOf<R extends RowSchema> = z.output<R>
type FieldOf<R extends RowSchema> = keyof RowOf<R> & string
type WhereOut<W> = [W] extends [undefined] ? Record<string, never> : z.output<SchemaOf<W>>
type WhereIn<W> = [W] extends [undefined] ? Record<string, never> : z.input<SchemaOf<W>>

/** Where `load` resumes from: the last row's sort key and id, decoded from the cursor. */
export type After = { key: SortKey; id: Scalar }

/** What `load` receives: parsed, normalized and resolved. */
export type LoadArgs<W, S extends string, F extends string> = {
  where: W
  sort: S
  dir: Dir
  /** The fields the response returns, so `load` may skip joins nobody asked for. */
  select: F[]
  /** How many rows to return. In cursor paging it's the page size plus one: the extra row tells kit there is a next page. */
  limit: number
  /** Cursor paging: the rows strictly after this `(key, id)` in `sort`/`dir` order; null on the first page. Always null in page paging. */
  after: After | null
  /** Page paging: the rows to skip. Always 0 in cursor paging. */
  offset: number
}

/**
 * The shape of `load`. Its return is checked at `createApp`, not here: checking it here makes a
 * `load` that calls `ctx.services` circular, as it would a method's body.
 */
type LoadFn<R extends RowSchema, W, S, H extends readonly string[]> = (
  args: LoadArgs<WhereOut<W>, keyof S & string, Exclude<FieldOf<R>, H[number]>>,
) => any

type LoadResult<Row, P extends Paging> = P extends "page"
  ? { rows: Row[]; total: number }
  : { rows: Row[] }

/** `"cursor"` (the default): an opaque `cursor`, stable under inserts. `"page"`: `page` numbers and a `total`. */
export type Paging = "cursor" | "page"

export type CollectionDef<
  R extends RowSchema,
  W extends SchemaLike | undefined,
  S extends Record<string, SortDef<RowOf<R>>>,
  D extends readonly FieldOf<R>[],
  H extends readonly FieldOf<R>[],
  G extends Exclude<FieldOf<R>, H[number]>,
  P extends Paging,
  L extends LoadFn<R, W, S, H>,
> = Omit<Contract, "input" | "output" | "ui"> & {
  /** Every field a row can have: what `load` returns. */
  row: R
  /** The field that breaks sort ties and identifies a row in the cursor. Default `"id"`. */
  id?: FieldOf<R>
  fields: {
    /** What a caller gets without `select`. Keep it to what picks a row. */
    default: D
    /** Never selectable and never returned, in any surface. */
    hidden?: H
    /** Fields only some callers see. Each check closes over the service's `ctx`. */
    gate?: { [K in G]: () => boolean }
  }
  /** The filters. Search is a filter too: a `q` with a `.describe()` saying what it matches. */
  where?: W
  /** Defaults that depend on other filters. Runs on every call, `next` included, so it must be idempotent. */
  normalize?: (where: WhereOut<W>) => WhereOut<W>
  sorts: S
  defaultSort: keyof S & string
  paging?: P
  limit: { default: number; max: number }
  /**
   * Reads one page. Apply the tenant and any row scope here, from `ctx`: it is the only path to
   * the data. Its rows are checked against `row` at `createApp`, like a method's return.
   */
  load: L
}

type Selection<F extends string> = "*" | readonly F[]

/** The input a collection takes. Every field is optional: `list()` is the first page. */
export type CollectionInput<W, F extends string, S extends string, P extends Paging, Sel> = {
  where?: WhereIn<W>
  select?: Sel
  sort?: S
  dir?: Dir
  limit?: number
} & (P extends "page" ? { page?: number } : { cursor?: string })

/** The input as applied: what `query` echoes and `next` extends. */
export type CollectionQuery<W, F extends string, S extends string, P extends Paging> = {
  where: WhereOut<W>
  select: F[]
  sort: S
  dir: Dir
  limit: number
} & (P extends "page" ? { page: number } : { cursor?: string })

type Picked<Row, Sel, D extends string, F extends string, G extends string> = Sel extends "*"
  ? Pick<Row, Exclude<F, G> & keyof Row> & Partial<Pick<Row, G & keyof Row>>
  : Sel extends readonly (infer K extends string)[]
    ? Pick<Row, Exclude<K, G> & keyof Row> & Partial<Pick<Row, K & G & keyof Row>>
    : Pick<Row, Exclude<D, G> & keyof Row> & Partial<Pick<Row, D & G & keyof Row>>

/** One page of a collection. Page paging adds `total`, how many rows match. */
export type Page<Row, Q, P extends Paging = "cursor"> = {
  rows: Row[]
  /** The input as applied: defaults filled in, filters normalized, `limit` clamped. */
  query: Q
  /** The whole input for the following page; null on the last one. */
  next: Q | null
} & (P extends "page" ? { total: number } : {})

/**
 * What `collection` returns: a method whose rows are narrowed to the `select`
 * an in-process caller passes. Discovery, `tools()` and MCP see a plain method.
 */
export type Collection<
  Row,
  W,
  F extends string,
  D extends string,
  G extends string,
  S extends string,
  P extends Paging,
  L = unknown,
> = Loads<L, LoadResult<Row, P>> & {
  <const Sel extends Selection<F> = readonly Extract<D, F>[]>(
    input?: CollectionInput<W, F, S, P, Sel>,
  ): Promise<Page<Picked<Row, Sel, D, F, G>, CollectionQuery<W, F, S, P>, P>>
  readonly [META]: MethodMeta<z.ZodType, z.ZodType<any>, never>
}

const PAGING_NOTE = {
  cursor:
    "Returns one page: `rows`, `query` (the input as applied, defaults filled in) and `next`, the whole input for the following page (null on the last one). To read on, send `next` back unchanged.",
  page: "Returns one page: `rows`, `total` (how many match), `query` (the input as applied, defaults filled in) and `next`, the whole input for the following page (null on the last one). To read on, send `next` back unchanged.",
}

const encode = (cursor: Cursor) => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const CursorSchema = z.object({
  s: z.string(),
  d: z.enum(["asc", "desc"]),
  k: z.union([ScalarSchema, z.array(ScalarSchema)]),
  i: ScalarSchema,
})
type Cursor = z.infer<typeof CursorSchema>

const badCursor = (): never => {
  throw invalidInput({
    cursor: ["not a cursor for this sort and direction; send `next` back unchanged"],
  })
}

const decode = (raw: string): Cursor => {
  let value: unknown
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"))
    value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
  } catch {
    return badCursor()
  }
  const parsed = CursorSchema.safeParse(value)
  if (!parsed.success) return badCursor()
  return parsed.data
}

const selectError = (message: string): never => {
  throw invalidInput({ select: [message] })
}

const pick = (row: Record<string, unknown>, fields: string[]) => {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in row) out[f] = row[f]
  return out
}

/**
 * A list method with one grammar for every app: `where` filters, `select`
 * fields, `sort` + `dir`, `limit`, and `cursor` or `page`. Every response is
 * `{ rows, query, next, total? }`: `query` is the input as applied and `next`
 * the input for the following page, so a caller never guesses a parameter.
 *
 * Declare it inside a service, like `method`: `load` closes over the service's
 * `ctx`, and is where the tenant and row scope apply.
 */
export function collection<
  R extends RowSchema,
  S extends Record<string, SortDef<RowOf<R>>>,
  const D extends readonly FieldOf<R>[],
  W extends SchemaLike | undefined = undefined,
  const H extends readonly FieldOf<R>[] = [],
  G extends Exclude<FieldOf<R>, H[number]> = never,
  P extends Paging = "cursor",
  L extends LoadFn<R, W, S, H> = LoadFn<R, W, S, H>,
>(
  def: CollectionDef<R, W, S, D, H, G, P, L>,
): Collection<RowOf<R>, W, Exclude<FieldOf<R>, H[number]>, D[number], G, keyof S & string, P, L> {
  const paging: Paging = def.paging ?? "cursor"
  const idField = def.id ?? "id"
  const hidden = new Set<string>(def.fields.hidden ?? [])
  const gate = (def.fields.gate ?? {}) as Record<string, () => boolean>
  const visible = Object.keys(def.row.shape).filter((f) => !hidden.has(f))
  const sortNames = Object.keys(def.sorts)

  if (!(idField in def.row.shape))
    throw new Error(`kit: collection id field "${idField}" is not in row`)
  if (!sortNames.includes(def.defaultSort))
    throw new Error(`kit: collection defaultSort "${def.defaultSort}" is not a declared sort`)
  for (const f of def.fields.default)
    if (hidden.has(f)) throw new Error(`kit: collection default field "${f}" is hidden`)
  if (def.limit.default < 1 || def.limit.max < def.limit.default)
    throw new Error("kit: collection limit needs 1 <= default <= max")

  const where = (def.where ? toSchema(def.where) : z.object({})).prefault({})
  const input = z.object({
    where: where.describe("Filters."),
    select: z
      .union([z.literal("*"), z.array(z.enum(visible as [string, ...string[]]))])
      .optional()
      .describe(
        `Fields to return. Omitted: ${def.fields.default.join(", ")}. "*": every field you may see.`,
      ),
    sort: z
      .enum(sortNames as [string, ...string[]])
      .optional()
      .describe(`Order. Omitted: ${def.defaultSort}.`),
    dir: z.enum(["asc", "desc"]).optional().describe("Direction. Omitted: the sort's own."),
    limit: z
      .int()
      .min(1)
      .optional()
      .describe(`Rows per page. Omitted: ${def.limit.default}; at most ${def.limit.max}.`),
    ...(paging === "page"
      ? { page: z.int().min(1).optional().describe("Page number, from 1.") }
      : { cursor: z.string().optional().describe("From `next`. Omitted: the first page.") }),
  })

  const visibleRow = def.row.pick(Object.fromEntries(visible.map((f) => [f, true])) as never)
  const echo = z.record(z.string(), z.unknown())
  const output = z.object({
    rows: z.array(visibleRow.partial()),
    query: echo.describe("The input as applied."),
    next: echo.nullable().describe("The input for the following page; null on the last one."),
    ...(paging === "page" && { total: z.int().min(0) }),
  })

  const allowed = (f: string) => !(f in gate) || gate[f]!()

  const contract: Contract = {
    summary: def.summary,
    description: `${def.description ?? def.summary}\n\n${PAGING_NOTE[paging]}`,
    permission: def.permission,
    input,
    output,
    hints: def.hints ?? { readOnly: true },
    ...(def.when && { when: def.when }),
    ...(def.name && { name: def.name }),
  }

  return method(contract as Contract<typeof input, typeof output>, async (raw) => {
    const args = raw as z.output<typeof input> & { cursor?: string; page?: number }

    let select: string[]
    if (args.select === undefined) select = def.fields.default.filter(allowed)
    else if (args.select === "*") select = visible.filter(allowed)
    else {
      const denied = args.select.filter((f) => !allowed(f))
      if (denied.length > 0) selectError(`not available to you: ${denied.join(", ")}`)
      select = [...new Set(args.select)]
    }

    const sort = args.sort ?? def.defaultSort
    const dir: Dir = args.dir ?? def.sorts[sort]!.dir
    const limit = Math.min(args.limit ?? def.limit.default, def.limit.max)
    const filters = (def.normalize ? def.normalize(args.where as never) : args.where) as Record<
      string,
      unknown
    >

    const position = args.cursor ? decode(args.cursor) : null
    if (position && (position.s !== sort || position.d !== dir)) badCursor()
    const page = paging === "page" ? (args.page ?? 1) : null

    const result: { rows: Record<string, unknown>[]; total?: number } = await def.load({
      where: filters as never,
      sort,
      dir,
      select: select as never,
      limit: page === null ? limit + 1 : limit,
      after: position ? { key: position.k, id: position.i } : null,
      offset: page === null ? 0 : (page - 1) * limit,
    })

    const query: Record<string, unknown> = {
      where: filters,
      select,
      sort,
      dir,
      limit,
      ...(page !== null && { page }),
    }

    if (page !== null) {
      if (typeof result.total !== "number")
        throw new Error(
          `kit: collection ${def.name ?? def.summary} (page paging) must return total`,
        )
      const rows = result.rows.slice(0, limit)
      return {
        rows: rows.map((r) => pick(r as never, select)),
        query,
        next: page * limit < result.total ? { ...query, page: page + 1 } : null,
        total: result.total,
      }
    }

    const more = result.rows.length > limit
    const rows = result.rows.slice(0, limit) as Record<string, unknown>[]
    const last = rows.at(-1)
    const next =
      more && last
        ? {
            ...query,
            cursor: encode({
              s: sort,
              d: dir,
              k: def.sorts[sort]!.key(last as never) as Cursor["k"],
              i: last[idField] as Scalar,
            }),
          }
        : null
    return {
      rows: rows.map((r) => pick(r, select)),
      query: position ? { ...query, cursor: args.cursor } : query,
      next,
    }
  }) as never
}
