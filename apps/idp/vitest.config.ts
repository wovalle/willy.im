import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

/**
 * Tests run in plain Node against an in-memory SQLite database (D1 is SQLite),
 * not under the Workers runtime — deliberately separate from vite.config.ts,
 * whose Cloudflare plugin would put every module in a workerd environment.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each file gets its own fresh database; no shared global state to protect.
    pool: "threads",
    server: { deps: { inline: [/@better-auth\//, /^better-auth/] } },
  },
})
