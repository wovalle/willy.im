import { defineConfig } from "vitest/config"

/**
 * Plain Node. Every test runs against an in-memory session store and a stubbed
 * IdP injected as `fetch` — nothing here touches the network.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
