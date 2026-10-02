import { defineConfig } from "vitest/config"

/**
 * Unit tests run in plain Node — deliberately separate from vite.config.ts,
 * whose Cloudflare plugin would put every module in a workerd environment.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "workers/**/*.test.ts"],
  },
})
