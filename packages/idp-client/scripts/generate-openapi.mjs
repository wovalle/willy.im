/**
 * Refresh `openapi/idp-api.json` from the operations table.
 *
 * The document is built by `src/schemas/openapi.ts` out of the zod schemas in
 * `src/schemas/index.ts` — the same code path `apps/idp` serves at
 * `/api/v1/openapi.json`, so the committed snapshot is by construction what
 * the server answers. Nothing to boot, nothing to bundle, no `apps/idp` at
 * publish time.
 *
 * There is no generated `.d.ts` any more: types are `z.infer` off the schemas.
 *
 *   npm run openapi     (runs the build first — it reads dist/)
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "..")
const output = join(packageRoot, "openapi/idp-api.json")

const { buildOpenApiDocument } = await import(
  join(packageRoot, "dist/src/schemas/openapi.js")
).catch((cause) => {
  throw new Error("dist/ is missing — run `npm run build` first", { cause })
})

const document = buildOpenApiDocument({ baseUrl: "https://idp.willy.im" })

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)
console.log(`wrote ${output}`)
