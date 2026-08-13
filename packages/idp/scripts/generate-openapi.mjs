/**
 * Refresh `openapi/idp-api.json` and `src/generated/idp-api.d.ts` from apps/idp.
 *
 * The document is built in a react-router loader (apps/idp/app/routes/api/openapi.ts)
 * out of the zod schemas in apps/idp/app/lib/api-schemas.ts. Rather than boot the
 * app and fetch it over HTTP — which would make the build depend on a running
 * server — we bundle that one module with esbuild (resolving the `~` alias the
 * way vite-tsconfig-paths does), call the loader with a stub context, and read
 * the JSON straight out of the Response it returns. Fully offline, and the
 * result is committed so publishing never needs apps/idp at all.
 *
 * openapi-typescript then turns that snapshot into `src/generated/idp-api.d.ts`
 * — types only, no runtime code, so core stays dependency-free.
 *
 *   npm run openapi
 */

import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

import { build } from "esbuild"

const run = promisify(execFile)

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * openapi-typescript output for the willy.im IdP management API
 * (\`/api/v1/*\`), generated from ../../openapi/idp-api.json, which is itself
 * generated from apps/idp's OpenAPI route. Regenerate with \`npm run openapi\`.
 *
 * The OIDC endpoints (discovery, authorize, token, userinfo, end-session) are
 * NOT here and never will be: they are standards-defined and discovered at
 * runtime from \`.well-known\`, not part of this document.
 */
`

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "..")
const repoRoot = resolve(packageRoot, "../..")
const idpApp = join(repoRoot, "apps/idp/app")
const entry = join(idpApp, "routes/api/openapi.ts")
const output = join(packageRoot, "openapi/idp-api.json")
const types = join(packageRoot, "src/generated/idp-api.d.ts")

const scratch = await mkdtemp(join(tmpdir(), "idp-openapi-"))
try {
  const bundle = join(scratch, "openapi.mjs")
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "warning",
    alias: { "~": idpApp },
  })

  const { loader } = await import(pathToFileURL(bundle).href)
  const response = await loader({
    // The loader reads one env var, for the `servers` entry.
    context: { getAppEnv: () => "https://idp.willy.im" },
  })
  const doc = await response.json()

  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(doc, null, 2)}\n`)
  const paths = Object.keys(doc.paths ?? {}).length
  console.log(`wrote ${output} (${paths} paths)`)

  await mkdir(dirname(types), { recursive: true })
  await run("npx", ["openapi-typescript", output, "-o", types], { cwd: packageRoot })
  await writeFile(types, `${HEADER}${await readFile(types, "utf8")}`)
  console.log(`wrote ${types}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
