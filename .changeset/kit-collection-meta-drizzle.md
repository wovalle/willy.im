---
"@willyim/kit": minor
---

`collection()`: page `meta`, per-sort cursor types and drizzle helpers.

- A collection may declare `meta` (a zod schema or shape). `load` may return `{ rows, meta }`, on whichever pages it chooses. The page then includes `meta`, typed by the schema in process and declared, optional, in the output schema, so `/api`, `tools()` and MCP pass it on. `createApp` checks the returned `meta` against the schema at compile time, as it does rows. A `load` that returns `meta` when the collection declares none is a compile error.
- `load`'s arguments are now a union over the sorts. Narrowing on `sort` types `after.key` as that sort's key (`number`, `string`, `[string, string]`…), and `after.id` has the type of the id field. A `key` that returns `[a, b]` is typed as a tuple.
- New `@willyim/kit/collection/drizzle` subpath. `cursorWhere(columns, after, dir)` builds the "strictly after this row" keyset predicate (`undefined` on the first page), and `orderFor(columns, dir)` builds the matching `orderBy`. Pass the sort key's columns with the id column last.
- The mismatch error at `createApp` now reads "loads rows or meta its schemas reject".
- Exported types changed. `LoadArgs<W, S, F>` is now `LoadArgs<W, F, Keys, Id>`, where `Keys` maps each sort name to its key type. `Collection` takes a `Meta` parameter before `L`. `After<K, Id>` is generic, and `SortKey` includes `readonly []`. Code that names these types needs updating.
