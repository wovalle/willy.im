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
/**
 * What a sort key may be: JSON scalars, or a tuple of them. A `Date` must be turned into an ISO string.
 * (`readonly []` is there so a `key` returning `[a, b]` is typed as a tuple, not an array.)
 */
export type SortKey = Scalar | readonly Scalar[] | readonly []

/** One sort a collection offers: its default direction, and the row's value it orders by. */
export type SortDef<Row> = {
  dir: Dir
  /** The row's position in this order. It goes into the cursor, so it must survive JSON. */
  key: (row: Row) => SortKey
}

type RowSchema = z.ZodObject
type RowOf<R extends RowSchema> = z.output<R>
type FieldOf<R extends RowSchema> = keyof RowOf<R> & string
type WhereOut<W> = [W] extends [SchemaLike] ? z.output<SchemaOf<W>> : Record<string, never>
type WhereIn<W> = [W] extends [SchemaLike] ? z.input<SchemaOf<W>> : Record<string, never>
type MetaOf<M> = [M] extends [SchemaLike] ? z.output<SchemaOf<M>> : never
/** Each sort's key type, by sort name. */
type KeysOf<S> = { [K in keyof S]: S[K] extends SortDef<any> ? ReturnType<S[K]["key"]> : never }

/** Where `load` resumes from: the last row's sort key and id, decoded from the cursor. */
export type After<K = SortKey, Id = Scalar> = { key: K; id: Id }

/**
 * What `load` receives: parsed, normalized and resolved. A union over the sorts, so a `load`
 * that narrows on `sort` gets that sort's key type in `after.key`.
 */
export type LoadArgs<
  W,
  F extends string,
  Keys extends Record<string, unknown> = Record<string, SortKey>,
  Id = Scalar,
> = {
  [K in keyof Keys & string]: {
    where: W
    sort: K
    dir: Dir
    /** The fields the response returns, so `load` may skip joins nobody asked for. */
    select: F[]
    /** How many rows to return. In cursor paging it's the page size plus one: the extra row tells kit there is a next page. */
    limit: number
    /** Cursor paging: the rows strictly after this `(key, id)` in `sort`/`dir` order; null on the first page. Always null in page paging. */
    after: After<Keys[K], Id> | null
    /** Page paging: the rows to skip. Always 0 in cursor paging. */
    offset: number
  }
}[keyof Keys & string]

/**
 * The shape of `load`. Its return is checked at `createApp`, not here: checking it here makes a
 * `load` that calls `ctx.services` circular, as it would a method's body. The definition types
 * `load` as `LoadFn & L`: `LoadFn` types its arguments, `L` (unconstrained, so it doesn't stand
 * in for them) captures the function for that check.
 */
type LoadFn<R extends RowSchema, W, S, H extends readonly string[], I extends FieldOf<R>> = (
  args: LoadArgs<WhereOut<W>, Exclude<FieldOf<R>, H[number]>, KeysOf<S>, RowOf<R>[I]>,
) => any

/** What `load` must return. `meta` only when the collection declares it. */
type LoadResult<Row, P extends Paging, Meta> = { rows: Row[]; meta?: Meta } & (P extends "page"
  ? { total: number }
  : {})

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
  I extends FieldOf<R>,
  M extends SchemaLike | undefined,
  L,
> = Omit<Contract, "input" | "output" | "ui"> & {
  /** Every field a row can have: what `load` returns. */
  row: R
  /** The field that breaks sort ties and identifies a row in the cursor. Default `"id"`. */
  id?: I
  fields: {
    /** What a caller gets without `select`. Keep it to what picks a row. */
    default: D
    /** Never selectable and never returned, in any surface. */
    hidden?: H
    /** Fields only some callers see. Each check closes over the service's `ctx`: the caller. */
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
   * What the list carries besides its rows (a thread's header, its participants): `load` may
   * return it next to `rows`, on whichever pages it decides, and the page passes it on.
   */
  meta?: M
  /**
   * Reads one page. Apply the tenant and any row scope here, from `ctx`: it is the only path to
   * the data. Its rows (and `meta`) are checked against `row` (and `meta`) at `createApp`, like a
   * method's return.
   */
  load: LoadFn<R, W, S, H, I> & L
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

/**
 * One page of a collection. Page paging adds `total`, how many rows match; a collection that
 * declares `meta` adds `meta`, present when `load` returned it.
 */
export type Page<Row, Q, P extends Paging = "cursor", Meta = never> = {
  rows: Row[]
  /** The input as applied: defaults filled in, filters normalized, `limit` clamped. */
  query: Q
  /** The whole input for the following page; null on the last one. */
  next: Q | null
} & (P extends "page" ? { total: number } : {}) &
  ([Meta] extends [never] ? {} : { meta?: Meta })

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
  Meta = never,
  L = unknown,
> = Loads<L, LoadResult<Row, P, Meta>> & {
  <const Sel extends Selection<F> = readonly Extract<D, F>[]>(
    input?: CollectionInput<W, F, S, P, Sel>,
  ): Promise<Page<Picked<Row, Sel, D, F, G>, CollectionQuery<W, F, S, P>, P, Meta>>
  readonly [META]: MethodMeta<z.ZodType, z.ZodType<any>, never>
}

const PAGING_NOTE = {
  cursor:
    "Returns one page: `rows`, `query` (the input as applied, defaults filled in) and `next`, the whole input for the following page (null on the last one). To read on, send `next` back unchanged.",
  page: "Returns one page: `rows`, `total` (how many match), `query` (the input as applied, defaults filled in) and `next`, the whole input for the following page (null on the last one). To read on, send `next` back unchanged.",
}

type Cursor = { s: string; d: Dir; k: SortKey; i: Scalar }

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

type AnyRow = Record<string, unknown>

// What `toSchema` tells apart: a plain shape, or a schema.
const isShape = (s: SchemaLike): s is z.core.$ZodShape => !("_zod" in s)

const pick = (row: AnyRow, fields: string[]) => {
  const out: AnyRow = {}
  for (const f of fields) if (f in row) out[f] = row[f]
  return out
}

/** A definition as the runtime reads it: the public signature's types, erased. */
type Def = Omit<Contract, "input" | "output" | "ui"> & {
  row: z.ZodObject
  id?: string
  fields: {
    default: readonly string[]
    hidden?: readonly string[]
    gate?: Partial<Record<string, () => boolean>>
  }
  where?: z.ZodType<AnyRow> | z.core.$ZodShape
  normalize?: (where: AnyRow) => AnyRow
  sorts: Record<string, SortDef<AnyRow>>
  defaultSort: string
  paging?: Paging
  limit: { default: number; max: number }
  meta?: SchemaLike
  load: (args: LoadArgs<AnyRow, string>) => LoadReturn | Promise<LoadReturn>
}
type LoadReturn = { rows: AnyRow[]; total?: number; meta?: unknown }

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
  I extends FieldOf<R> = "id" & FieldOf<R>,
  M extends SchemaLike | undefined = undefined,
  L = unknown,
>(
  def: CollectionDef<R, W, S, D, H, G, P, I, M, L>,
): Collection<
  RowOf<R>,
  W,
  Exclude<FieldOf<R>, H[number]>,
  D[number],
  G,
  keyof S & string,
  P,
  MetaOf<M>,
  L
>
export function collection(def: Def): unknown {
  const paging = def.paging ?? "cursor"
  const idField = def.id ?? "id"
  const hidden = new Set(def.fields.hidden)
  const gate = def.fields.gate ?? {}
  const visible = Object.keys(def.row.shape).filter((f) => !hidden.has(f))
  const sortNames = Object.keys(def.sorts)
  const name = def.name ?? def.summary

  if (!(idField in def.row.shape))
    throw new Error(`kit: collection id field "${idField}" is not in row`)
  if (!sortNames.includes(def.defaultSort))
    throw new Error(`kit: collection defaultSort "${def.defaultSort}" is not a declared sort`)
  for (const f of def.fields.default)
    if (hidden.has(f)) throw new Error(`kit: collection default field "${f}" is hidden`)
  if (def.limit.default < 1 || def.limit.max < def.limit.default)
    throw new Error("kit: collection limit needs 1 <= default <= max")

  const where: z.ZodType<AnyRow> =
    def.where === undefined ? z.object({}) : isShape(def.where) ? z.object(def.where) : def.where
  const input = z.object({
    where: where.prefault({}).describe("Filters."),
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
    ...(def.meta && { meta: toSchema(def.meta).optional() }),
  })

  const allowed = (f: string) => gate[f]?.() ?? true

  const contract: Contract<typeof input, typeof output> = {
    summary: def.summary,
    description: `${def.description ?? def.summary}\n\n${PAGING_NOTE[paging]}`,
    permission: def.permission,
    input,
    output,
    hints: def.hints ?? { readOnly: true },
    ...(def.when && { when: def.when }),
    ...(def.name && { name: def.name }),
  }

  type Args = z.output<typeof input> & { cursor?: string; page?: number }

  return method(contract, async (args: Args) => {
    let select: string[]
    if (args.select === undefined) select = def.fields.default.filter(allowed)
    else if (args.select === "*") select = visible.filter(allowed)
    else {
      const denied = args.select.filter((f) => !allowed(f))
      if (denied.length > 0) selectError(`not available to you: ${denied.join(", ")}`)
      select = [...new Set(args.select)]
    }

    const sort = args.sort ?? def.defaultSort
    const dir = args.dir ?? def.sorts[sort]!.dir
    const limit = Math.min(args.limit ?? def.limit.default, def.limit.max)
    const filters = def.normalize ? def.normalize(args.where) : args.where

    const position = args.cursor ? decode(args.cursor) : null
    if (position && (position.s !== sort || position.d !== dir)) badCursor()
    const page = paging === "page" ? (args.page ?? 1) : null

    const result = await def.load({
      where: filters,
      sort,
      dir,
      select,
      limit: page === null ? limit + 1 : limit,
      after: position ? { key: position.k, id: position.i } : null,
      offset: page === null ? 0 : (page - 1) * limit,
    })
    const meta = result.meta !== undefined && { meta: result.meta }

    const query: AnyRow = {
      where: filters,
      select,
      sort,
      dir,
      limit,
      ...(page !== null && { page }),
    }

    if (page !== null) {
      if (typeof result.total !== "number")
        throw new Error(`kit: collection ${name} (page paging) must return total`)
      return {
        rows: result.rows.slice(0, limit).map((r) => pick(r, select)),
        query,
        next: page * limit < result.total ? { ...query, page: page + 1 } : null,
        total: result.total,
        ...meta,
      }
    }

    const more = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    let next: AnyRow | null = null
    if (more && last) {
      const id = ScalarSchema.safeParse(last[idField])
      if (!id.success)
        throw new Error(`kit: collection ${name} row ${idField} must be a JSON scalar`)
      const k = def.sorts[sort]!.key(last)
      next = { ...query, cursor: encode({ s: sort, d: dir, k, i: id.data }) }
    }
    return {
      rows: rows.map((r) => pick(r, select)),
      query: position ? { ...query, cursor: args.cursor } : query,
      next,
      ...meta,
    }
  })
}
