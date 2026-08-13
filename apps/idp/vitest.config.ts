import { createRequire } from "node:module"
import { dirname } from "node:path"

import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// drizzle-orm is installed under this app, not the workspace root, so packages
// hoisted to the root (better-auth's drizzle adapter) can't resolve it on their
// own. Point every drizzle-orm specifier at this app's copy — the test-runner
// equivalent of vite.config.ts's `dedupe`.
const require = createRequire(import.meta.url)
// drizzle-orm's exports map hides package.json, so resolve its entry instead.
const drizzleRoot = dirname(require.resolve("drizzle-orm"))

/**
 * Tests run in plain Node against an in-memory SQLite database (D1 is SQLite),
 * not under the Workers runtime — deliberately separate from vite.config.ts,
 * whose Cloudflare plugin would put every module in a workerd environment.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    dedupe: ["drizzle-orm"],
    alias: [{ find: /^drizzle-orm(\/.*)?$/, replacement: `${drizzleRoot}$1` }],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each file gets its own fresh database; no shared global state to protect.
    pool: "threads",
    server: { deps: { inline: [/@better-auth\//, /^better-auth/] } },
  },
})
